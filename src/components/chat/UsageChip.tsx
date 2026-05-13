import { useUsageStatsStore } from '@/stores/usageStatsStore';
import { useI18n } from '@/i18n';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function UsageChip({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  const usage = useUsageStatsStore((s) => s.conversationTotals[conversationId]);

  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) return null;

  const total = usage.inputTokens + usage.outputTokens;
  const hasCacheData = usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0;

  const tooltip = [
    `${t.chat.usageChipInput}: ${formatTokens(usage.inputTokens)}${hasCacheData ? ` (${t.chat.usageChipCache} ${formatTokens(usage.cacheReadTokens)})` : ''}`,
    `${t.chat.usageChipOutput}: ${formatTokens(usage.outputTokens)}`,
    `${usage.requests} ${t.chat.usageChipRequests}`,
  ].join(' · ');

  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 text-[11px] text-[var(--abu-text-muted)] tabular-nums select-none"
    >
      <span>{formatTokens(total)}</span>
      <span className="opacity-50">·</span>
      <span>{usage.requests} {t.chat.usageChipRequests}</span>
    </span>
  );
}
