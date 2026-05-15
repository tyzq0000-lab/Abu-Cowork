import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { expertCategories } from '@/data/experts/categories';
import type { TranslationDict } from '@/i18n/types';

interface CategoryNavProps {
  selected: string;
  onSelect: (id: string) => void;
}

export default function CategoryNav({ selected, onSelect }: CategoryNavProps) {
  const { t } = useI18n();

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
      {expertCategories.map((cat) => {
        const label = t.experts[cat.labelKey as keyof TranslationDict['experts']] as string;
        const isActive = selected === cat.id;

        return (
          <button
            key={cat.id}
            disabled={cat.disabled}
            onClick={() => !cat.disabled && onSelect(cat.id)}
            className={cn(
              'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors whitespace-nowrap',
              isActive && !cat.disabled
                ? 'bg-[var(--abu-clay)] text-white'
                : cat.disabled
                  ? 'text-[var(--abu-text-muted)] cursor-not-allowed opacity-50'
                  : 'bg-[var(--abu-bg-active)] text-[var(--abu-text-secondary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)]'
            )}
          >
            <span className="text-[12px] leading-none">{cat.icon}</span>
            <span>{label}</span>
            {cat.disabled && (
              <span className="ml-0.5 text-[10px] opacity-60">
                {t.experts.comingSoon}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
