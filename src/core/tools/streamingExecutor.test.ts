import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingToolExecutor, type ToolExecResult } from './streamingExecutor';
import type { ToolCall } from '../../types';

// Mock getAllTools to control concurrency safety
vi.mock('../tools/registry', () => ({
  getAllTools: () => [
    { name: 'read_file', isConcurrencySafe: true },
    { name: 'grep', isConcurrencySafe: true },
    { name: 'list_directory', isConcurrencySafe: true },
    { name: 'write_file', isConcurrencySafe: false },
    { name: 'run_command', isConcurrencySafe: (input: Record<string, unknown>) => input.command === 'ls' },
    { name: 'edit_file', isConcurrencySafe: false },
  ],
}));

function makeToolCall(name: string, id?: string, input?: Record<string, unknown>): ToolCall {
  return {
    id: id ?? `tool_${name}_${Date.now()}`,
    name,
    input: input ?? {},
    isExecuting: false,
  };
}

function makeSuccessResult(id: string, duration = 10): ToolExecResult {
  return { id, result: 'ok', resultContent: undefined, error: false, duration };
}

describe('StreamingToolExecutor', () => {
  let executionOrder: string[];
  let executeFn: (tc: ToolCall) => Promise<ToolExecResult>;

  beforeEach(() => {
    executionOrder = [];
    executeFn = async (tc: ToolCall) => {
      executionOrder.push(tc.name);
      // Simulate some async work
      await new Promise(r => setTimeout(r, 5));
      return makeSuccessResult(tc.id);
    };
  });

  it('executes concurrent-safe tools in parallel', async () => {
    const executor = new StreamingToolExecutor(executeFn);

    executor.addTool(makeToolCall('read_file', 'a'));
    executor.addTool(makeToolCall('grep', 'b'));
    executor.addTool(makeToolCall('list_directory', 'c'));

    await executor.waitForAll();

    const results = executor.getResults();
    expect(results).toHaveLength(3);
    expect(results.every(r => !r.error)).toBe(true);
  });

  it('executes exclusive tools sequentially', async () => {
    const executor = new StreamingToolExecutor(executeFn);

    executor.addTool(makeToolCall('write_file', 'a'));
    executor.addTool(makeToolCall('edit_file', 'b'));

    await executor.waitForAll();

    const results = executor.getResults();
    expect(results).toHaveLength(2);
    // Both should have completed (sequentially)
    expect(executionOrder).toEqual(['write_file', 'edit_file']);
  });

  it('blocks concurrent tools behind exclusive tool', async () => {
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};

    const slowExecute = async (tc: ToolCall) => {
      startTimes[tc.id] = Date.now();
      await new Promise(r => setTimeout(r, 20));
      endTimes[tc.id] = Date.now();
      return makeSuccessResult(tc.id);
    };

    const executor = new StreamingToolExecutor(slowExecute);

    executor.addTool(makeToolCall('write_file', 'exclusive'));
    executor.addTool(makeToolCall('read_file', 'after'));

    await executor.waitForAll();

    // read_file should start after write_file completes
    expect(startTimes['after']).toBeGreaterThanOrEqual(endTimes['exclusive'] - 1);
  });

  it('supports input-conditional concurrency (run_command)', async () => {
    const executor = new StreamingToolExecutor(executeFn);

    // 'ls' is read-only → concurrent-safe
    executor.addTool(makeToolCall('run_command', 'a', { command: 'ls' }));
    executor.addTool(makeToolCall('read_file', 'b'));

    await executor.waitForAll();

    const results = executor.getResults();
    expect(results).toHaveLength(2);
    expect(results.every(r => !r.error)).toBe(true);
  });

  it('returns results in order received', async () => {
    const executor = new StreamingToolExecutor(executeFn);

    executor.addTool(makeToolCall('read_file', 'first'));
    executor.addTool(makeToolCall('grep', 'second'));
    executor.addTool(makeToolCall('list_directory', 'third'));

    await executor.waitForAll();

    const results = executor.getResults();
    expect(results.map(r => r.id)).toEqual(['first', 'second', 'third']);
  });

  it('handles tool errors gracefully', async () => {
    const errorExecute = async (tc: ToolCall) => {
      if (tc.name === 'read_file') throw new Error('File not found');
      return makeSuccessResult(tc.id);
    };

    const executor = new StreamingToolExecutor(errorExecute);
    executor.addTool(makeToolCall('read_file', 'fail'));
    executor.addTool(makeToolCall('grep', 'ok'));

    await executor.waitForAll();

    const results = executor.getResults();
    expect(results[0].error).toBe(true);
    expect(results[0].result).toContain('File not found');
    expect(results[1].error).toBe(false);
  });

  it('handles empty executor', async () => {
    const executor = new StreamingToolExecutor(executeFn);
    await executor.waitForAll();
    expect(executor.getResults()).toEqual([]);
    expect(executor.size).toBe(0);
  });

  it('reports size correctly', () => {
    const executor = new StreamingToolExecutor(executeFn);
    expect(executor.size).toBe(0);
    executor.addTool(makeToolCall('read_file'));
    expect(executor.size).toBe(1);
    executor.addTool(makeToolCall('grep'));
    expect(executor.size).toBe(2);
  });
});
