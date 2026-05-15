import { cn } from '@/lib/utils';
import type { MarketplaceItem } from '@/types/marketplace';

interface ExpertCardProps {
  expert: MarketplaceItem;
  onClick: (expert: MarketplaceItem) => void;
}

export default function ExpertCard({ expert, onClick }: ExpertCardProps) {
  return (
    <button
      onClick={() => onClick(expert)}
      className={cn(
        'group flex flex-col items-start gap-3 w-full rounded-xl p-4 text-left',
        'bg-[var(--abu-bg-subtle)] border border-[var(--abu-border)]',
        'hover:border-[var(--abu-clay)] hover:shadow-sm transition-all duration-150'
      )}
    >
      {/* Avatar */}
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--abu-bg-active)] text-2xl select-none">
        {expert.name ? getAvatarFromContent(expert.content) || '🤖' : '🤖'}
      </div>

      {/* Name */}
      <div className="w-full">
        <p className="text-sm font-semibold text-[var(--abu-text-primary)] leading-snug">
          {expert.name}
        </p>

        {/* Tags */}
        {expert.tags && expert.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {expert.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--abu-bg-active)] text-[var(--abu-text-tertiary)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      <p className="text-[12px] text-[var(--abu-text-secondary)] leading-relaxed line-clamp-2">
        {expert.description}
      </p>
    </button>
  );
}

/** Extract avatar emoji from AGENT.md frontmatter content string */
function getAvatarFromContent(content?: string): string | undefined {
  if (!content) return undefined;
  const match = content.match(/^---[\s\S]*?avatar:\s*(.+?)\s*\n/m);
  return match?.[1];
}
