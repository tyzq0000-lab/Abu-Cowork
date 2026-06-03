import { Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n, format } from '@/i18n';
import { useChatStore } from '@/stores/chatStore';
import { calculateWarningLevel } from '@/core/context/autoCompact';
import { cn } from '@/lib/utils';

const RING_SIZE = 16;
const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function levelColorClass(level: 0 | 1 | 2 | 3): string {
  switch (level) {
    case 0: return 'text-zinc-400/40';
    case 1: return 'text-yellow-500';
    case 2: return 'text-orange-500';
    case 3: return 'text-red-500 animate-pulse';
  }
}

export default function ContextIndicator({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  const usage = useChatStore((s) => s.conversations[conversationId]?.contextUsage);
  const isCompressing = useChatStore((s) => s.conversations[conversationId]?.isCompressing ?? false);

  const level: 0 | 1 | 2 | 3 = usage
    ? calculateWarningLevel(usage.tokensUsed, usage.tokensMax)
    : 0;

  const dashOffset = usage
    ? RING_CIRCUMFERENCE * (1 - Math.min(usage.percent, 100) / 100)
    : RING_CIRCUMFERENCE;

  const tooltipText = isCompressing
    ? t.chat.contextTooltipCompressing
    : usage
      ? format(t.chat.contextTooltipUsage, {
          percent: String(usage.percent),
          used: formatK(usage.tokensUsed),
          max: formatK(usage.tokensMax),
        })
      : t.chat.contextTooltipIdle;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={tooltipText}
            data-testid="context-indicator"
            className="inline-flex items-center justify-center select-none"
            style={{ width: RING_SIZE, height: RING_SIZE }}
          >
            {isCompressing ? (
              <Loader2 className="text-purple-400 animate-spin" style={{ width: RING_SIZE, height: RING_SIZE }} />
            ) : (
              <svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 16 16">
                <circle
                  cx="8" cy="8" r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-zinc-500/25"
                />
                {usage && (
                  <circle
                    cx="8" cy="8" r={RING_RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 8 8)"
                    className={cn('transition-[stroke-dashoffset,color] duration-300', levelColorClass(level))}
                  />
                )}
              </svg>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
