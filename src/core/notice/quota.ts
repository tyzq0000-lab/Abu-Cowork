/**
 * L2 per-hour sliding-window quota.
 *
 * Sliding window avoids the fixed-hour-bucket edge case where 3 notices
 * at 11:55 + 3 at 12:05 both pass (6 in 10 min). With sliding window,
 * the cutoff is always "last 60 min from now".
 *
 * Module-level timestamps[] acts as a singleton — acceptable because
 * Notice system is per-process, and process restart resets quota (safe
 * since restart means user was away).
 */

export const L2_WINDOW_MS = 60 * 60 * 1000;
export const L2_QUOTA = 3;

const timestamps: number[] = [];

/** True if an L2 notice can be delivered right now. */
export function checkL2Quota(now: number = Date.now()): boolean {
  const cutoff = now - L2_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
  return timestamps.length < L2_QUOTA;
}

/** Record an L2 delivery. Call after Gate allows an L2 notice. */
export function consumeL2Quota(now: number = Date.now()): void {
  timestamps.push(now);
}

/** Reset for tests. */
export function clearQuotaForTest(): void {
  timestamps.length = 0;
}
