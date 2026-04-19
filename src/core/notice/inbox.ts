/**
 * Notice Inbox — L2 queue for notices that Gate deferred (queue_inbox).
 *
 * Storage: `{app_data_dir}/notice.sqlite` (notice_inbox table).
 * When Gate returns queue_inbox (fullscreen, quota exceeded), the
 * pipeline stores the notice here. Later, when context changes (user
 * returns, window refocused), a drain pass delivers pending inbox
 * items via main_window_toast channel.
 *
 * Lifecycle:
 *   1. Pipeline → queueToInbox(notice) on queue_inbox decision
 *   2. App focus event → drainInbox() delivers pending via toast
 *   3. Periodic cleanup removes expired + delivered entries
 */

import { invoke } from '@tauri-apps/api/core';
import type { Notice } from './types';

// ── Types (mirror Rust InboxEntry) ─────────────────────────────────────

export interface InboxEntry {
  id: number;
  notice_id: string;
  notice_json: string;
  tier: string;
  queued_at: number;
  expires_at: number;
  delivered: boolean;
}

// ── Write ──────────────────────────────────────────────────────────────

/**
 * Queue a notice to inbox. Fire-and-forget.
 */
export function queueToInbox(notice: Notice): void {
  const entry = {
    notice_id: notice.id,
    notice_json: JSON.stringify(notice),
    tier: notice.tier,
    queued_at: notice.createdAt,
    expires_at: notice.createdAt + (notice.ttl ?? 24 * 60 * 60 * 1000),
  };

  invokeInbox('notice_inbox_insert', { entry }).catch((err) => {
    console.warn('[notice:inbox] queue failed:', err);
  });
}

// ── Read ───────────────────────────────────────────────────────────────

/** Get all pending (undelivered, unexpired) inbox entries. */
export async function getPendingInbox(): Promise<InboxEntry[]> {
  const now = Date.now();
  return invokeInbox<InboxEntry[]>('notice_inbox_pending', { now });
}

// ── Lifecycle ──────────────────────────────────────────────────────────

/** Mark a notice as delivered (after toast/badge shown). */
export function markDelivered(noticeId: string): void {
  invokeInbox('notice_inbox_mark_delivered', { noticeId }).catch((err) => {
    console.warn('[notice:inbox] mark delivered failed:', err);
  });
}

/** Remove expired + delivered entries. Returns count deleted. */
export async function cleanupInbox(): Promise<number> {
  const now = Date.now();
  return invokeInbox<number>('notice_inbox_cleanup', { now });
}

// ── Helpers ────────────────────────────────────────────────────────────

async function invokeInbox<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    const result = invoke(cmd, args);
    if (result && typeof (result as Promise<T>).then === 'function') {
      return await (result as Promise<T>);
    }
    return result as T;
  } catch (err) {
    console.warn(`[notice:inbox] ${cmd} failed:`, err);
    throw err;
  }
}
