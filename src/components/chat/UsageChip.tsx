import { useUsageStatsStore } from '@/stores/usageStatsStore';
import { useI18n } from '@/i18n';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

  const bodyLine = [
    `${t.chat.usageChipInput}: ${formatTokens(usage.inputTokens)}${hasCacheData ? ` (${t.chat.usageChipCache} ${formatTokens(usage.cacheReadTokens)})` : ''}`,
    `${t.chat.usageChipOutput}: ${formatTokens(usage.outputTokens)}`,
    `${usage.requests} ${t.chat.usageChipRequests}`,
  ].join(' · ');

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1 text-[11px] text-[var(--abu-text-muted)] tabular-nums select-none cursor-default"
          >
            <span>{formatTokens(total)}</span>
            <span className="opacity-50">·</span>
            <span>{usage.requests} {t.chat.usageChipRequests}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex flex-col items-start gap-0.5 max-w-xs">
          <span className="text-[10px] opacity-60 leading-tight">
            {t.chat.usageChipSubtitle}
          </span>
          <span className="leading-tight">{bodyLine}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
