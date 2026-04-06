/**
 * Background Agent Registry — tracks fire-and-forget agent tasks.
 *
 * When `delegate_to_agent` is called with `async: true`, the subagent runs
 * in the background. This registry tracks their lifecycle and injects results
 * back into the parent conversation via userInputQueue.
 */

import { enqueueUserInput } from './userInputQueue';

/**
 * Check if a conversation still exists in chatStore.
 * Uses lazy dynamic import to avoid circular dependency.
 */
let _getConversations: (() => Record<string, unknown>) | null = null;

/** Allow external code to inject the conversation lookup (avoids circular import) */
export function setConversationLookup(fn: () => Record<string, unknown>): void {
  _getConversations = fn;
}

function conversationExists(conversationId: string): boolean {
  if (!_getConversations) return true; // not yet wired, assume exists
  return !!_getConversations()[conversationId];
}

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
  /** Current activity description for UI (e.g. "web_search: React SSR") */
  currentActivity?: string;
  /** Number of tool calls executed so far */
  toolCallCount?: number;
}

const MAX_CONCURRENT_AGENTS_PER_CONVERSATION = 5;

/** Active and recently-completed background agents */
const agents = new Map<string, BackgroundAgent>();

/** Cleanup timer IDs so they can be cancelled on early removal */
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

/** Get background agents for a specific conversation */
export function getAgentsByConversation(conversationId: string): BackgroundAgent[] {
  return [...agents.values()].filter(a => a.conversationId === conversationId);
}

/** Get only running agents */
export function getRunningAgents(): BackgroundAgent[] {
  return [...agents.values()].filter(a => a.status === 'running');
}

/** Check if we can spawn another background agent (per-conversation limit) */
export function canSpawnAgent(conversationId?: string): boolean {
  if (conversationId) {
    const convRunning = [...agents.values()].filter(
      a => a.conversationId === conversationId && a.status === 'running'
    );
    return convRunning.length < MAX_CONCURRENT_AGENTS_PER_CONVERSATION;
  }
  return getRunningAgents().length < MAX_CONCURRENT_AGENTS_PER_CONVERSATION;
}

/** Update progress for a running background agent */
export function updateAgentProgress(taskId: string, activity: string, toolCallCount: number): void {
  const agent = agents.get(taskId);
  if (!agent || agent.status !== 'running') return;
  agent.currentActivity = activity;
  agent.toolCallCount = toolCallCount;
  notify();
}

/** Register a new background agent */
export function registerBackgroundAgent(agent: BackgroundAgent): void {
  if (!agent.conversationId) {
    console.error('[BackgroundAgentRegistry] Cannot register agent without conversationId:', agent.taskId);
    return;
  }
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

  // Validate conversation still exists before injecting result
  if (!conversationExists(agent.conversationId)) {
    console.warn(`[BackgroundAgentRegistry] Conversation ${agent.conversationId} no longer exists, discarding result for agent ${taskId}`);
    scheduleCleanup(taskId);
    return;
  }

  // Inject structured result into parent conversation
  const durationSec = Math.round(((agent.endTime ?? Date.now()) - agent.startTime) / 1000);
  const toolCount = agent.toolCallCount ?? 0;
  // Truncate very long results to avoid bloating context
  const maxResultLen = 3000;
  const truncatedResult = result.length > maxResultLen
    ? result.slice(0, maxResultLen) + `\n...(结果已截断，完整内容共 ${result.length} 字符)`
    : result;
  const resultMessage = [
    `<agent-result task-id="${taskId}" agent="${agent.agentName}" status="completed">`,
    `<summary>代理 "${agent.agentName}" 已完成任务，耗时 ${durationSec}s，调用 ${toolCount} 次工具</summary>`,
    `<result>\n${truncatedResult}\n</result>`,
    `</agent-result>`,
  ].join('\n');
  enqueueUserInput(agent.conversationId, resultMessage, true);

  scheduleCleanup(taskId);
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

  // Validate conversation still exists before injecting error
  if (conversationExists(agent.conversationId)) {
    const errorMessage = `<agent-result task-id="${taskId}" agent="${agent.agentName}" status="error">\nError: ${error}\n</agent-result>`;
    enqueueUserInput(agent.conversationId, errorMessage, true);
  } else {
    console.warn(`[BackgroundAgentRegistry] Conversation ${agent.conversationId} no longer exists, discarding error for agent ${taskId}`);
  }

  scheduleCleanup(taskId);
}

/** Remove a background agent (e.g. on cancel), cancelling any pending cleanup timer */
export function removeBackgroundAgent(taskId: string): void {
  cancelCleanupTimer(taskId);
  agents.delete(taskId);
  notify();
}

/**
 * Remove all background agents for a conversation.
 * Returns subagentIds of running agents (caller should cancel them).
 */
export function removeAgentsByConversation(conversationId: string): string[] {
  const runningSubagentIds: string[] = [];
  for (const [taskId, agent] of agents) {
    if (agent.conversationId === conversationId) {
      if (agent.status === 'running') {
        runningSubagentIds.push(agent.subagentId);
      }
      cancelCleanupTimer(taskId);
      agents.delete(taskId);
    }
  }
  if (runningSubagentIds.length > 0 || agents.size > 0) {
    notify();
  }
  return runningSubagentIds;
}

// --- Internal timer helpers ---

function scheduleCleanup(taskId: string): void {
  cancelCleanupTimer(taskId);
  const timerId = setTimeout(() => {
    cleanupTimers.delete(taskId);
    if (agents.get(taskId)?.status !== 'running') {
      agents.delete(taskId);
      notify();
    }
  }, 30_000);
  cleanupTimers.set(taskId, timerId);
}

function cancelCleanupTimer(taskId: string): void {
  const timerId = cleanupTimers.get(taskId);
  if (timerId != null) {
    clearTimeout(timerId);
    cleanupTimers.delete(taskId);
  }
}
