import type { TokenUsage } from '@/types';

/**
 * Records per-turn token usage into usageStatsStore.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function recordTurnUsage(
  sessionId: string,
  model: string,
  skill: string | null,
  usage: TokenUsage,
): void {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return;

  import('@/stores/usageStatsStore').then(({ useUsageStatsStore }) => {
    useUsageStatsStore.getState().recordTurn({
      sessionId,
      model,
      skill,
      inputTokens,
      outputTokens,
      cacheReadTokens: usage.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
    });
  }).catch(() => {});
}
