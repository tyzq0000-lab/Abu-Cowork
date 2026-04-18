/**
 * ProactivityPicker — permanent home for the 主动度 preset (shy /
 * companion / butler). SkillDraftsPanel has a one-time onboarding
 * card for first-draft users, but they need a persistent place to
 * switch later — this is it.
 *
 * Mounted at the top of SoulSection since proactivity is a facet of
 * Abu's persona. Matches the PRD's "主动度 Preset UI" task; stats
 * tracking (7-day accept/reject counts) is deliberately out of scope
 * until the counter infrastructure exists.
 */

import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { cn } from '@/lib/utils';

type Level = 'shy' | 'companion' | 'butler';

interface Option {
  id: Level;
  emoji: string;
  titleKey: keyof ReturnType<typeof useI18n>['t']['toolbox'];
  descKey: keyof ReturnType<typeof useI18n>['t']['toolbox'];
}

const OPTIONS: Option[] = [
  { id: 'shy', emoji: '🌱', titleKey: 'draftsOnboardPickShy', descKey: 'draftsOnboardShyDesc' },
  { id: 'companion', emoji: '🌿', titleKey: 'draftsOnboardPickCompanion', descKey: 'draftsOnboardCompanionDesc' },
  { id: 'butler', emoji: '🌳', titleKey: 'draftsOnboardPickButler', descKey: 'draftsOnboardButlerDesc' },
];

export default function ProactivityPicker() {
  const { t } = useI18n();
  const current = useSettingsStore((s) => s.soul?.proactivity ?? 'companion');
  const setProactivity = useSettingsStore((s) => s.setProactivity);

  return (
    <div className="rounded-xl border border-[var(--abu-border)] bg-[var(--abu-bg-elevated)] p-4">
      <div>
        <h4 className="text-[14px] font-semibold text-[var(--abu-text-primary)]">
          {t.soul.proactivityTitle}
        </h4>
        <p className="text-[12px] text-[var(--abu-text-muted)] mt-1 leading-relaxed">
          {t.soul.proactivityDesc}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {OPTIONS.map((opt) => {
          const selected = current === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setProactivity(opt.id)}
              className={cn(
                'flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg text-left transition-colors border',
                selected
                  ? 'bg-[var(--abu-clay-tint)] border-[var(--abu-clay-ring)]'
                  : 'border-[var(--abu-border-subtle)] hover:bg-[var(--abu-bg-active)]',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-base leading-none">{opt.emoji}</span>
                <span className="text-[12px] font-semibold text-[var(--abu-text-primary)]">
                  {t.toolbox[opt.titleKey]}
                </span>
              </div>
              <p className="text-[11px] text-[var(--abu-text-muted)] leading-snug">
                {t.toolbox[opt.descKey]}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
