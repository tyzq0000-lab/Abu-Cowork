/**
 * ShareExportDialog — preview-before-export UI for conversation sharing.
 *
 * The dialog mounts in "loading" state, builds the ShareBundle via
 * `chatStore.exportConversationForShare`, then renders three panels:
 *   1. Visibility summary (what the recipient will / will not see)
 *   2. Redaction summary (how many credentials / paths got replaced)
 *   3. Lightweight message preview (text-only — not a full MessageBubble)
 *
 * Clicking "Export" triggers a Tauri save-dialog and writes the JSON.
 * Cancel / backdrop click dismisses without writing anything.
 */

import { useEffect, useState } from 'react';
import { X, Eye, EyeOff, Download, ShieldAlert, Wrench, MessageSquare, FileText, Image as ImageIcon } from 'lucide-react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useChatStore } from '@/stores/chatStore';
import { useI18n, format } from '@/i18n';
import { serializeShareBundle, type ShareBundle } from '@/core/session/shareBundle';
import type { MessageContent, ToolCall } from '@/types';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';

interface ShareExportDialogProps {
  convId: string;
  defaultFilename: string;
  onClose: () => void;
}

type DialogState =
  | { phase: 'loading' }
  | { phase: 'ready'; bundle: ShareBundle }
  | { phase: 'error'; message: string };

export default function ShareExportDialog({ convId, defaultFilename, onClose }: ShareExportDialogProps) {
  const { t } = useI18n();
  const exportForShare = useChatStore((s) => s.exportConversationForShare);
  const [state, setState] = useState<DialogState>({ phase: 'loading' });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    exportForShare(convId)
      .then((bundle) => {
        if (cancelled) return;
        if (!bundle) {
          setState({ phase: 'error', message: 'conversation not found' });
          return;
        }
        setState({ phase: 'ready', bundle });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [convId, exportForShare]);

  const handleExport = async () => {
    if (state.phase !== 'ready' || exporting) return;
    setExporting(true);
    try {
      const filePath = await saveDialog({
        defaultPath: defaultFilename,
        filters: [{ name: 'Abu Conversation', extensions: ['json'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, serializeShareBundle(state.bundle));
        onClose();
      }
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-[640px] max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-[var(--abu-border)]">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--abu-text-primary)]">
              {t.share.exportDialogTitle}
            </h3>
            <p className="text-[12px] text-[var(--abu-text-tertiary)] mt-0.5">
              {t.share.tierStandard} — {t.share.tierNote}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--abu-bg-hover)] text-[var(--abu-text-tertiary)]"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {state.phase === 'loading' && (
            <div className="text-[13px] text-[var(--abu-text-tertiary)] py-8 text-center">
              {t.share.loading}
            </div>
          )}
          {state.phase === 'error' && (
            <div className="text-[13px] text-red-600 py-8 text-center">
              {format(t.share.exportError, { error: state.message })}
            </div>
          )}
          {state.phase === 'ready' && <BundlePreview bundle={state.bundle} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--abu-border)]">
          <div className="text-[12px] text-[var(--abu-text-tertiary)]">
            {state.phase === 'ready' && (
              <StatsLine bundle={state.bundle} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-[13px] text-[var(--abu-text-secondary)] hover:bg-[var(--abu-bg-hover)]"
            >
              {t.share.cancel}
            </button>
            <button
              onClick={handleExport}
              disabled={state.phase !== 'ready' || exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--abu-clay)] text-white text-[13px] hover:bg-[var(--abu-clay-dark)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5" />
              {t.share.exportBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Inner sections
// ───────────────────────────────────────────────────────────────────────────

function BundlePreview({ bundle }: { bundle: ShareBundle }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      {/* Visibility summary */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[var(--abu-border)] p-3">
          <div className="flex items-center gap-1.5 mb-2 text-[13px] font-medium text-[var(--abu-text-primary)]">
            <Eye className="h-3.5 w-3.5 text-emerald-600" />
            {t.share.visibleToOthers}
          </div>
          <ul className="space-y-1 text-[12px] text-[var(--abu-text-secondary)]">
            <li>✅ {t.share.itemMessages}</li>
            <li>✅ {t.share.itemToolCalls}</li>
            <li>✅ {t.share.itemAiGenerated}</li>
          </ul>
        </div>
        <div className="rounded-lg border border-[var(--abu-border)] p-3">
          <div className="flex items-center gap-1.5 mb-2 text-[13px] font-medium text-[var(--abu-text-primary)]">
            <EyeOff className="h-3.5 w-3.5 text-[var(--abu-text-tertiary)]" />
            {t.share.hiddenFromOthers}
          </div>
          <ul className="space-y-1 text-[12px] text-[var(--abu-text-secondary)]">
            <li>❌ {t.share.itemUserFiles}</li>
            <li>❌ {t.share.itemCredentials}</li>
          </ul>
        </div>
      </section>

      {/* Redaction summary */}
      <section className="rounded-lg border border-[var(--abu-border)] p-3">
        <div className="flex items-center gap-1.5 mb-2 text-[13px] font-medium text-[var(--abu-text-primary)]">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
          {t.share.redactionTitle}
          {bundle.stats.redactionCount > 0 && (
            <span className="text-[12px] text-[var(--abu-text-tertiary)] ml-1">
              · {format(t.share.redactionCount, { count: bundle.stats.redactionCount })}
            </span>
          )}
        </div>
        {bundle.stats.redactionCount === 0 ? (
          <p className="text-[12px] text-[var(--abu-text-tertiary)]">{t.share.noRedaction}</p>
        ) : (
          <ul className="space-y-0.5 text-[12px] text-[var(--abu-text-secondary)] font-mono">
            {summarizeRedactionKinds(bundle).map((line) => (
              <li key={line}>• {line}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Message preview */}
      <section className="rounded-lg border border-[var(--abu-border)] p-3">
        <div className="flex items-center gap-1.5 mb-2 text-[13px] font-medium text-[var(--abu-text-primary)]">
          <MessageSquare className="h-3.5 w-3.5 text-[var(--abu-clay)]" />
          {t.share.previewTitle}
        </div>
        {bundle.messages.length === 0 ? (
          <p className="text-[12px] text-[var(--abu-text-tertiary)]">{t.share.previewEmpty}</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto">
            {bundle.messages.slice(0, 50).map((msg) => (
              <MessagePreviewRow
                key={msg.id}
                role={msg.role}
                content={msg.content}
                toolCalls={msg.toolCalls}
              />
            ))}
            {bundle.messages.length > 50 && (
              <p className="text-[11px] text-[var(--abu-text-muted)] text-center pt-1">
                … {bundle.messages.length - 50} more
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function MessagePreviewRow({
  role,
  content,
  toolCalls,
}: {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
  toolCalls?: ToolCall[];
}) {
  const roleLabel = role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'System';
  const badge = role === 'user'
    ? 'bg-blue-50 text-blue-700'
    : role === 'assistant'
      ? 'bg-[var(--abu-clay-10)] text-[var(--abu-clay)]'
      : 'bg-gray-100 text-gray-600';

  const { text, imageCount, otherCount } = flattenContent(content);
  // Truncate on the raw text so large messages don't bloat the preview.
  // Markdown still renders within the truncated slice (unmatched fences
  // are harmless — react-markdown just treats them as text).
  const truncated = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  const toolNames = (toolCalls ?? []).map((tc) => tc.name);

  return (
    <div className="flex gap-2 items-start">
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge}`}>
        {roleLabel}
      </span>
      <div className="flex-1 min-w-0">
        {truncated && (
          <div className="text-[12px] text-[var(--abu-text-primary)] leading-relaxed share-preview-md">
            <MarkdownRenderer content={truncated} variant={role === 'user' ? 'user' : 'assistant'} />
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 mt-1">
          {imageCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--abu-text-tertiary)]">
              <ImageIcon className="h-3 w-3" /> {imageCount}
            </span>
          )}
          {otherCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--abu-text-tertiary)]">
              <FileText className="h-3 w-3" /> {otherCount}
            </span>
          )}
          {toolNames.slice(0, 3).map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--abu-bg-subtle)] text-[10px] text-[var(--abu-text-tertiary)] font-mono"
            >
              <Wrench className="h-3 w-3" />
              {name}
            </span>
          ))}
          {toolNames.length > 3 && (
            <span className="inline-flex items-center text-[10px] text-[var(--abu-text-tertiary)]">
              +{toolNames.length - 3}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsLine({ bundle }: { bundle: ShareBundle }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
      <span>{format(t.share.statsMessages, { count: bundle.messages.length })}</span>
      <span>·</span>
      <span>{format(t.share.statsAttachments, { count: bundle.stats.attachmentCount })}</span>
      <span>·</span>
      <span>{format(t.share.statsSize, { size: formatBytes(bundle.stats.sizeBytes) })}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

function flattenContent(content: string | MessageContent[]): { text: string; imageCount: number; otherCount: number } {
  if (typeof content === 'string') return { text: content, imageCount: 0, otherCount: 0 };
  let text = '';
  let imageCount = 0;
  let otherCount = 0;
  for (const block of content) {
    if (block.type === 'text') text += (text ? '\n' : '') + block.text;
    else if (block.type === 'image') imageCount += 1;
    else otherCount += 1;
  }
  return { text, imageCount, otherCount };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Group redaction sample kinds with counts, e.g. "anthropic-key · 2". */
function summarizeRedactionKinds(bundle: ShareBundle): string[] {
  // We don't have per-kind counts in stats (only total), but we can at least
  // surface that N redactions happened. If the bundle grows to include per-
  // sample breakdown later, this is where to expand. For now, show a single
  // aggregated line.
  return [`${bundle.stats.redactionCount} × credential / path occurrence(s)`];
}
