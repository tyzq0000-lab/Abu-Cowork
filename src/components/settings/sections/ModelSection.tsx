import { useI18n } from '@/i18n';

/**
 * Legacy model section — replaced by ModelConfigSection.
 * Kept as a minimal stub to avoid breaking barrel exports.
 */
export default function ModelSection() {
  const { t } = useI18n();
  return (
    <div className="p-4 text-sm text-[var(--abu-text-tertiary)]">
      {t.settings.model}
    </div>
  );
}
