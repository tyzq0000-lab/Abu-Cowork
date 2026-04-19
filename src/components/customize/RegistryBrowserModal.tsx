/**
 * RegistryBrowserModal — list of pluggable third-party skill sources.
 *
 * Opened from the Toolbox's 第三方市场 category. Lists every adapter
 * registered via `registerAdapter()`, with a live availability badge
 * per row (refreshed every time the modal opens; registrations change
 * rarely so we don't bother subscribing for deltas).
 *
 * At this stage (Task #25 D-UI) we don't ship any real adapters, so
 * the empty state is the common view — the modal exists so the
 * "third-party" feature has a landing surface, and adapters plugging
 * in later get a ready UX. The "browse skills" flow (search, install
 * from registry) is the next D increment and will open on top of
 * this modal when an available adapter is clicked.
 *
 * Rendering rules
 * - No adapters registered → big placeholder explaining the feature
 *   is on the way. No confusing empty list.
 * - Adapters registered, none available → rows render in "dim" state
 *   with the reason (e.g. "CLI not installed"). No "browse" action.
 * - Adapters registered + available → rows are clickable; clicking
 *   currently shows a "not yet wired" toast (placeholder for D).
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Package, CheckCircle, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useI18n } from '@/i18n';
import { useToastStore } from '@/stores/toastStore';
import { listAdapters, type RegistryAdapter } from '@/core/skill/registries';

interface Props {
  onClose: () => void;
}

interface AdapterRow {
  adapter: RegistryAdapter;
  available: boolean;
}

export default function RegistryBrowserModal({ onClose }: Props) {
  const { t } = useI18n();
  const addToast = useToastStore((s) => s.addToast);

  const [rows, setRows] = useState<AdapterRow[] | null>(null);

  const loadRows = useCallback(async () => {
    const adapters = listAdapters();
    // Probe availability in parallel; individual timeouts are the
    // adapter's responsibility (they must not throw, per interface
    // contract in types.ts).
    const entries = await Promise.all(
      adapters.map(async (adapter) => ({
        adapter,
        available: await adapter.isAvailable().catch(() => false),
      })),
    );
    setRows(entries);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const handleBrowse = async (row: AdapterRow) => {
    if (!row.available) return;
    const { adapter } = row;
    if (adapter.externalBrowseUrl) {
      // Browser-handoff: open the registry's website in the system
      // browser. Users download a .askill file there and re-import
      // via Toolbox → Import (Task #25 B). A short-lived info toast
      // reminds them of this flow so the "why did it open a browser?"
      // question doesn't come up.
      try {
        await openExternal(adapter.externalBrowseUrl);
        addToast({
          type: 'info',
          title: adapter.displayName,
          message: t.toolbox.registryExternalBrowseHint,
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: adapter.displayName,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    // In-app browse flow hasn't shipped yet. Surface a toast so the
    // row feels clickable but the unfinished path is legible.
    addToast({
      type: 'info',
      title: t.toolbox.registryBrowseComingSoon,
      message: adapter.displayName,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--abu-bg-active)]">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-[var(--abu-text-tertiary)]" />
            <h2 className="text-base font-semibold text-[var(--abu-text-primary)]">
              {t.toolbox.registryModalTitle}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--abu-text-muted)] hover:text-[var(--abu-text-secondary)] hover:bg-[var(--abu-bg-active)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overlay-scroll px-5 py-4">
          {rows === null ? (
            <div className="py-8 text-center">
              <Loader2 className="h-4 w-4 mx-auto animate-spin text-[var(--abu-text-muted)]" />
            </div>
          ) : rows.length === 0 ? (
            // Framework-only state: no adapters compiled in yet.
            // Copy leans on naming familiar registries so users
            // recognize what's coming without overpromising timelines.
            <div className="py-8 text-center text-sm text-[var(--abu-text-muted)] leading-relaxed px-4">
              {t.toolbox.registryEmptyTitle}
              <div className="text-[11px] text-[var(--abu-text-placeholder)] mt-2">
                {t.toolbox.registryEmptyHint}
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <AdapterRowView key={row.adapter.id} row={row} onClick={() => handleBrowse(row)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function AdapterRowView({ row, onClick }: { row: AdapterRow; onClick: () => void }) {
  const { t } = useI18n();
  const { adapter, available } = row;
  const isExternal = !!adapter.externalBrowseUrl;
  return (
    <li>
      <button
        onClick={onClick}
        disabled={!available}
        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
          available
            ? 'border-[var(--abu-border)] hover:bg-[var(--abu-bg-muted)] cursor-pointer'
            : 'border-[var(--abu-border-subtle)] bg-[var(--abu-bg-muted)]/40 opacity-70 cursor-not-allowed'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--abu-text-primary)]">
            {adapter.displayName}
          </span>
          {available ? (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">
              <CheckCircle className="h-3 w-3" />
              {t.toolbox.registryStatusAvailable}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--abu-bg-muted)] text-[var(--abu-text-muted)]">
              <AlertCircle className="h-3 w-3" />
              {t.toolbox.registryStatusUnavailable}
            </span>
          )}
          {adapter.capabilities.requiresAuth && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
              {t.toolbox.registryRequiresAuth}
            </span>
          )}
          {isExternal && available && (
            // Signals "clicking opens your browser, not an in-app
            // view" — important UX affordance since these rows behave
            // differently from future in-app registry browsers.
            <ExternalLink className="h-3 w-3 text-[var(--abu-text-muted)] ml-auto" />
          )}
        </div>
        {adapter.description && (
          <div className="text-[11px] text-[var(--abu-text-muted)] mt-0.5 leading-relaxed">
            {adapter.description}
          </div>
        )}
      </button>
    </li>
  );
}
