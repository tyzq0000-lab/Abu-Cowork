import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'normal';
  confirmDisabled?: boolean;
  /** Card width in px. Defaults to 360 — the size every plain text confirm uses. */
  width?: number;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  variant = 'normal',
  confirmDisabled = false,
  width = 360,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  // Portal to body so the dialog escapes any ancestor containing block —
  // ProviderCard sits inside ScrollArea/transformed parents, and rendering
  // inline made `fixed inset-0` resolve relative to the nearest transformed
  // ancestor instead of the viewport, leaving the dialog mis-positioned and
  // the backdrop clipped.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/*
        The card MUST stay height-capped with a scrollable body — do not "simplify"
        max-h / overflow / min-h-0 away. The backdrop centers with flex, and a flex
        item taller than the viewport overflows off BOTH edges, so the footer scrolls
        out of reach past the bottom of the screen (unreachable, not just clipped —
        the backdrop is `fixed inset-0`, so there is nothing to scroll). Tall content
        (EmployeeRuntimeSetupDialog) hit exactly this in a non-maximized window.
        Layout contract: title fixed / body scrolls / footer always visible.
      */}
      <div
        className="flex max-h-[85vh] max-w-[calc(100vw-2rem)] flex-col bg-white rounded-2xl shadow-xl p-6 animate-in zoom-in-95 duration-150"
        style={{ width }}
      >
        <h3 className="shrink-0 text-[16px] font-semibold text-[var(--abu-text-primary)] mb-2">
          {title}
        </h3>
        <div className="min-h-0 flex-1 overflow-y-auto text-[14px] text-[var(--abu-text-tertiary)] leading-relaxed mb-6">
          {message}
        </div>
        <div className="shrink-0 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--abu-text-tertiary)] hover:bg-[var(--abu-bg-muted)] transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={cn(
              'px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-colors',
              confirmDisabled && 'cursor-not-allowed opacity-50',
              variant === 'danger'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-[var(--abu-clay)] hover:bg-[var(--abu-clay-hover)]'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
