/**
 * Streaming Tool Executor — executes tools as they arrive during LLM streaming.
 *
 * Instead of waiting for all tool_use blocks to arrive before executing,
 * this executor starts running concurrent-safe tools immediately as they
 * stream in, reducing total agent loop latency by 30-50%.
 *
 * Concurrency model:
 * - Concurrent-safe tools (read_file, grep, etc.) run in parallel
 * - Exclusive tools (write_file, run_command) run one at a time
 * - Non-concurrent tools preserve order (if A is exclusive and queued before B,
 *   B waits for A even if B is concurrent-safe)
 *
 * Error cascade: if a run_command tool errors, sibling tools are aborted
 * (matches Claude Code behavior — bash errors are more likely to be fatal).
 */

import type { ToolCall, ToolDefinition } from '../../types';
import { getAllTools } from '../tools/registry';
import { TOOL_NAMES } from '../tools/toolNames';
import { createLogger } from '../logging/logger';

const logger = createLogger('streamingExecutor');

type ToolStatus = 'queued' | 'executing' | 'completed' | 'error';

export interface TrackedTool {
  toolCall: ToolCall;
  status: ToolStatus;
  isConcurrencySafe: boolean;
  promise?: Promise<void>;
  result?: ToolExecResult;
}

export interface ToolExecResult {
  id: string;
  result: string;
  resultContent: import('../../types').ToolResultContent[] | undefined;
  error: boolean;
  duration: number;
}

type ExecuteFn = (toolCall: ToolCall) => Promise<ToolExecResult>;

export class StreamingToolExecutor {
  private tools: TrackedTool[] = [];
  private siblingAbortController = new AbortController();
  private executeFn: ExecuteFn;
  private hasErrored = false;

  constructor(executeFn: ExecuteFn) {
    this.executeFn = executeFn;
  }

  /**
   * Add a tool call received during streaming. If the tool is concurrent-safe
   * and no exclusive tool is running, execution starts immediately.
   */
  addTool(toolCall: ToolCall): void {
    const isSafe = this.checkConcurrencySafe(toolCall);
    const tracked: TrackedTool = {
      toolCall,
      status: 'queued',
      isConcurrencySafe: isSafe,
    };
    this.tools.push(tracked);
    logger.info('Tool queued', { name: toolCall.name, isConcurrencySafe: isSafe });
    this.processQueue();
  }

  /**
   * Check if a tool can execute in parallel based on its definition.
   */
  private checkConcurrencySafe(toolCall: ToolCall): boolean {
    const allTools = getAllTools();
    const def = allTools.find((t: ToolDefinition) => t.name === toolCall.name);
    if (!def?.isConcurrencySafe) return false;

    if (typeof def.isConcurrencySafe === 'function') {
      try {
        return def.isConcurrencySafe(toolCall.input);
      } catch {
        return false;
      }
    }
    return def.isConcurrencySafe === true;
  }

  /**
   * Check if a tool can execute now based on the current queue state.
   */
  private canExecuteNow(tool: TrackedTool): boolean {
    if (this.hasErrored) return false;

    const executing = this.tools.filter(t => t.status === 'executing');

    // If nothing is executing, any tool can start
    if (executing.length === 0) return true;

    // Concurrent-safe tool can execute if all executing tools are also concurrent-safe
    if (tool.isConcurrencySafe) {
      return executing.every(t => t.isConcurrencySafe);
    }

    // Exclusive tool: must wait until nothing is executing
    return false;
  }

  /**
   * Process the queue — start executing tools that are ready.
   */
  private processQueue(): void {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue;

      if (this.canExecuteNow(tool)) {
        this.startExecution(tool);
      } else if (!tool.isConcurrencySafe) {
        // Non-concurrent tool can't execute — stop processing to maintain order
        break;
      }
    }
  }

  /**
   * Start executing a single tool in the background.
   */
  private startExecution(tool: TrackedTool): void {
    tool.status = 'executing';
    tool.promise = this.executeAndTrack(tool);
  }

  private async executeAndTrack(tool: TrackedTool): Promise<void> {
    try {
      // Check sibling abort before starting
      if (this.siblingAbortController.signal.aborted) {
        tool.status = 'error';
        tool.result = {
          id: tool.toolCall.id,
          result: '[Cancelled: sibling tool error]',
          resultContent: undefined,
          error: true,
          duration: 0,
        };
        return;
      }

      const result = await this.executeFn(tool.toolCall);
      tool.result = result;
      tool.status = result.error ? 'error' : 'completed';

      // If a run_command errors, abort sibling tools (bash errors are often fatal)
      if (result.error && tool.toolCall.name === TOOL_NAMES.RUN_COMMAND) {
        this.hasErrored = true;
        this.siblingAbortController.abort('sibling_error');
        logger.info('Sibling abort triggered by run_command error', { toolId: tool.toolCall.id });
      }
    } catch (err) {
      tool.status = 'error';
      tool.result = {
        id: tool.toolCall.id,
        result: `Error: ${err instanceof Error ? err.message : String(err)}`,
        resultContent: undefined,
        error: true,
        duration: 0,
      };
    }

    // After completion, try to process more queued tools
    this.processQueue();
  }

  /**
   * Wait for all queued and executing tools to complete.
   * Call this after LLM streaming ends.
   */
  async waitForAll(): Promise<void> {
    // First, ensure all queued tools get started
    this.processQueue();

    // Wait for all promises
    const promises = this.tools
      .filter(t => t.promise)
      .map(t => t.promise!);

    await Promise.allSettled(promises);

    // Final queue drain — some tools may have been queued after exclusive tools completed
    // Need to check if there are any remaining queued tools
    const remaining = this.tools.filter(t => t.status === 'queued');
    if (remaining.length > 0) {
      this.processQueue();
      const newPromises = remaining
        .filter(t => t.promise)
        .map(t => t.promise!);
      await Promise.allSettled(newPromises);
    }
  }

  /**
   * Get all results in the order tools were received.
   */
  getResults(): ToolExecResult[] {
    return this.tools.map(t => {
      if (t.result) return t.result;
      // Fallback for tools that never executed (e.g., aborted)
      return {
        id: t.toolCall.id,
        result: '[Not executed]',
        resultContent: undefined,
        error: true,
        duration: 0,
      };
    });
  }

  /**
   * Get the tracked tools list (for UI/debugging).
   */
  getTrackedTools(): readonly TrackedTool[] {
    return this.tools;
  }

  /**
   * Number of tools in the executor.
   */
  get size(): number {
    return this.tools.length;
  }
}
