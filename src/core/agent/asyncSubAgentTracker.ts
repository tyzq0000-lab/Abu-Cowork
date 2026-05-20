/**
 * Ref-count tracker for in-flight async sub-agents per loopId.
 *
 * Why: when delegate_to_agent({async:true}) fires, the parent loop may finish
 * and call persistExecutionSnapshot before the sub-agents complete their tool
 * calls. The tracker lets persistExecutionSnapshot skip eviction while async
 * sub-agents are still running, then triggers a final re-snapshot + evict once
 * the last one finishes.
 */
const pendingCounts = new Map<string, number>();

export function incrementAsyncSubAgent(loopId: string): void {
  pendingCounts.set(loopId, (pendingCounts.get(loopId) ?? 0) + 1);
}

/** Returns true when this was the last pending sub-agent for this loopId. */
export function decrementAsyncSubAgent(loopId: string): boolean {
  const next = (pendingCounts.get(loopId) ?? 1) - 1;
  if (next <= 0) {
    pendingCounts.delete(loopId);
    return true;
  }
  pendingCounts.set(loopId, next);
  return false;
}

export function hasPendingAsyncSubAgents(loopId: string): boolean {
  return (pendingCounts.get(loopId) ?? 0) > 0;
}
