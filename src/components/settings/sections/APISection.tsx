import { useI18n } from '@/i18n';

/**
 * Legacy API section — replaced by ModelConfigSection.
 * Kept as a minimal stub to avoid breaking barrel exports.
 */
export default function APISection() {
  const { t } = useI18n();
  return (
    <div className="p-4 text-sm text-[var(--abu-text-tertiary)]">
      {t.settings.provider}
    </div>
  );
}
