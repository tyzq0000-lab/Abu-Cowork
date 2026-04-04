import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerBackgroundAgent,
  completeBackgroundAgent,
  failBackgroundAgent,
  removeBackgroundAgent,
  getBackgroundAgents,
  getRunningAgents,
  canSpawnAgent,
} from './backgroundAgentRegistry';

// Mock userInputQueue to capture injected messages
vi.mock('./userInputQueue', () => ({
  enqueueUserInput: vi.fn(),
}));

import { enqueueUserInput } from './userInputQueue';

function makeAgent(taskId: string, overrides?: Record<string, unknown>) {
  return {
    taskId,
    agentName: 'test-agent',
    task: 'test task',
    status: 'running' as const,
    startTime: Date.now(),
    conversationId: 'conv-1',
    subagentId: 'sub-1',
    ...overrides,
  };
}

describe('backgroundAgentRegistry', () => {
  beforeEach(() => {
    // Clean up all agents
    for (const a of getBackgroundAgents()) {
      removeBackgroundAgent(a.taskId);
    }
    vi.clearAllMocks();
  });

  it('registers and retrieves agents', () => {
    registerBackgroundAgent(makeAgent('t1'));
    expect(getBackgroundAgents()).toHaveLength(1);
    expect(getBackgroundAgents()[0].taskId).toBe('t1');
  });

  it('completes agent and injects result', () => {
    registerBackgroundAgent(makeAgent('t1'));
    completeBackgroundAgent('t1', 'done!');

    const agents = getBackgroundAgents();
    expect(agents[0].status).toBe('completed');
    expect(agents[0].result).toBe('done!');
    expect(enqueueUserInput).toHaveBeenCalledWith(
      'conv-1',
      expect.stringContaining('<agent-result'),
      true,
    );
  });

  it('fails agent and injects error', () => {
    registerBackgroundAgent(makeAgent('t1'));
    failBackgroundAgent('t1', 'oops');

    const agents = getBackgroundAgents();
    expect(agents[0].status).toBe('error');
    expect(agents[0].error).toBe('oops');
    expect(enqueueUserInput).toHaveBeenCalled();
  });

  it('removes agent', () => {
    registerBackgroundAgent(makeAgent('t1'));
    removeBackgroundAgent('t1');
    expect(getBackgroundAgents()).toHaveLength(0);
  });

  it('tracks running agents', () => {
    registerBackgroundAgent(makeAgent('t1'));
    registerBackgroundAgent(makeAgent('t2'));
    completeBackgroundAgent('t1', 'done');

    expect(getRunningAgents()).toHaveLength(1);
    expect(getRunningAgents()[0].taskId).toBe('t2');
  });

  it('enforces concurrency limit', () => {
    for (let i = 0; i < 5; i++) {
      registerBackgroundAgent(makeAgent(`t${i}`));
    }
    expect(canSpawnAgent()).toBe(false);

    completeBackgroundAgent('t0', 'done');
    expect(canSpawnAgent()).toBe(true);
  });
});
