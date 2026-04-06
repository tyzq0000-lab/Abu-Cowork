import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/i18n';
import { loadSoul, saveSoul, getDefaultSoulTemplate } from '@/core/agent/soulConfig';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export default function SoulSection() {
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [isCustomized, setIsCustomized] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const soul = await loadSoul();
      if (soul) {
        setContent(soul);
        setIsCustomized(true);
        setEditing(true);
      } else {
        setContent('');
        setIsCustomized(false);
        setEditing(false);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCustomize = () => {
    setContent(getDefaultSoulTemplate());
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSoul(content);
      setIsCustomized(!!content.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save soul:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    setSaving(true);
    try {
      await saveSoul('');
      setContent('');
      setIsCustomized(false);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to restore soul:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-[var(--abu-clay)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold text-[var(--abu-text-primary)]">
          {t.soul.title}
        </h3>
        <p className="text-[13px] text-[var(--abu-text-muted)] mt-1">
          {t.soul.subtitle}
        </p>
      </div>

      {!editing ? (
        /* Not customized — show default preview + customize button */
        <div className="space-y-3">
          <div className="px-4 py-3 rounded-lg border border-[var(--abu-border)] bg-[var(--abu-bg-muted)]">
            <p className="text-[12px] text-[var(--abu-text-placeholder)] mb-2">{t.soul.defaultLabel}</p>
            <pre className="text-[13px] text-[var(--abu-text-tertiary)] font-mono leading-relaxed whitespace-pre-wrap">
              {getDefaultSoulTemplate()}
            </pre>
          </div>
          <Button variant="outline" size="sm" onClick={handleCustomize}>
            {t.soul.customize}
          </Button>
        </div>
      ) : (
        /* Editing mode — textarea + save/restore */
        <div className="space-y-3">
          <div className="relative">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-[13px] leading-relaxed min-h-[300px] resize-y"
              placeholder={t.soul.placeholder}
            />
            <span className={`absolute bottom-2 right-3 text-[11px] ${content.length > 2000 ? 'text-red-500' : 'text-[var(--abu-text-placeholder)]'}`}>
              {content.length} / 2000
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || content.length > 2000}
            >
              {saved ? t.soul.saved : t.soul.save}
            </Button>
            {isCustomized && (
              <Button variant="ghost" size="sm" onClick={handleRestore} disabled={saving}>
                {t.soul.restore}
              </Button>
            )}
          </div>

          <p className="text-[11px] text-[var(--abu-text-placeholder)]">
            {t.soul.filePath}
          </p>
        </div>
      )}
    </div>
  );
}
