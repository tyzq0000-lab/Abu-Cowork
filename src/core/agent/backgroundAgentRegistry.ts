/**
 * Background Agent Registry — tracks fire-and-forget agent tasks.
 *
 * When `delegate_to_agent` is called with `async: true`, the subagent runs
 * in the background. This registry tracks their lifecycle and injects results
 * back into the parent conversation via userInputQueue.
 */

import { enqueueUserInput } from './userInputQueue';

export interface BackgroundAgent {
  taskId: string;
  agentName: string;
  task: string;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  startTime: number;
  endTime?: number;
  conversationId: string;
  /** Links to subagentAbort for cancellation */
  subagentId: string;
}

const MAX_CONCURRENT_AGENTS = 5;

/** Active and recently-completed background agents */
const agents = new Map<string, BackgroundAgent>();

/** Subscribers for useSyncExternalStore */
const listeners = new Set<() => void>();
let snapshotVersion = 0;

function notify(): void {
  snapshotVersion++;
  for (const cb of listeners) cb();
}

/** Subscribe to registry changes (for useSyncExternalStore) */
export function subscribeToBackgroundAgents(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Snapshot version for useSyncExternalStore */
export function getBackgroundAgentsSnapshot(): number {
  return snapshotVersion;
}

/** Get all background agents (active + recently completed) */
export function getBackgroundAgents(): BackgroundAgent[] {
  return [...agents.values()];
}

/** Get only running agents */
export function getRunningAgents(): BackgroundAgent[] {
  return [...agents.values()].filter(a => a.status === 'running');
}

/** Check if we can spawn another background agent */
export function canSpawnAgent(): boolean {
  return getRunningAgents().length < MAX_CONCURRENT_AGENTS;
}

/** Register a new background agent */
export function registerBackgroundAgent(agent: BackgroundAgent): void {
  agents.set(agent.taskId, agent);
  notify();
}

/**
 * Mark a background agent as completed and inject result into parent conversation.
 * The result is injected as a hidden system message via userInputQueue,
 * picked up by the main agent loop's drainQueuedInputs() on the next turn.
 */
export function completeBackgroundAgent(taskId: string, result: string): void {
  const agent = agents.get(taskId);
  if (!agent) return;

  agent.status = 'completed';
  agent.result = result;
  agent.endTime = Date.now();
  notify();

  // Inject result into parent conversation as a system message
  const resultMessage = `<agent-result task-id="${taskId}" agent="${agent.agentName}" status="completed">\n${result}\n</agent-result>`;
  enqueueUserInput(agent.conversationId, resultMessage, true);

  // Auto-cleanup completed agents after 30s
  setTimeout(() => {
    if (agents.get(taskId)?.status !== 'running') {
      agents.delete(taskId);
      notify();
    }
  }, 30_000);
}

/**
 * Mark a background agent as failed and inject error into parent conversation.
 */
export function failBackgroundAgent(taskId: string, error: string): void {
  const agent = agents.get(taskId);
  if (!agent) return;

  agent.status = 'error';
  agent.error = error;
  agent.endTime = Date.now();
  notify();

  // Inject error into parent conversation
  const errorMessage = `<agent-result task-id="${taskId}" agent="${agent.agentName}" status="error">\nError: ${error}\n</agent-result>`;
  enqueueUserInput(agent.conversationId, errorMessage, true);

  // Auto-cleanup after 30s
  setTimeout(() => {
    if (agents.get(taskId)?.status !== 'running') {
      agents.delete(taskId);
      notify();
    }
  }, 30_000);
}

/** Remove a background agent (e.g. on cancel) */
export function removeBackgroundAgent(taskId: string): void {
  agents.delete(taskId);
  notify();
}
