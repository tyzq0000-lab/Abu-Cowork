/**
 * Notice Audit — records every Gate decision to SQLite via Rust.
 *
 * Storage: `{app_data_dir}/notice.sqlite` (notice_audit table).
 * Pipeline calls recordAudit() after every processNotice; the call
 * is fire-and-forget (async invoke, errors logged but not propagated).
 */

import { invoke } from '@tauri-apps/api/core';
import type { Notice } from './types';
import type { GateDecision } from './gate';
import type { DeliveryTarget } from './router';

// ── Types (mirror Rust AuditEntry) ─────────────────────────────────────

export interface AuditEntry {
  id: number;
  notice_id: string;
  type: string;
  tier: string;
  source: string;
  decision: string;
  reason: string | null;
  delivered_to: string[];
  timestamp: number;
}

// ── Write ──────────────────────────────────────────────────────────────

/**
 * Record a pipeline decision in the audit log.
 * Fire-and-forget — does not block the pipeline.
 */
export function recordAudit(
  notice: Notice,
  decision: GateDecision,
  targets: DeliveryTarget[],
): void {
  const entry = {
    notice_id: notice.id,
    type: notice.type,
    tier: notice.tier,
    source: notice.source,
    decision: decision.action,
    reason: 'reason' in decision ? decision.reason : null,
    delivered_to: targets.map((t) => t.channel),
    timestamp: notice.createdAt,
  };

  invokeAudit('notice_audit_insert', { entry }).catch((err) => {
    console.warn('[notice:audit] insert failed:', err);
  });
}

// ── Read ───────────────────────────────────────────────────────────────

/** Query audit entries within a time window. */
export async function queryAudit(
  since: number,
  until: number = Date.now(),
  noticeType?: string,
  limit = 100,
): Promise<AuditEntry[]> {
  return invokeAudit<AuditEntry[]>('notice_audit_query', {
    since,
    until,
    noticeType: noticeType ?? null,
    limit,
  });
}

/** Aggregate decision counts within a time window. */
export async function aggregateDecisions(
  since: number,
  until: number = Date.now(),
): Promise<Record<string, number>> {
  const pairs = await invokeAudit<[string, number][]>(
    'notice_audit_aggregate',
    { since, until },
  );
  const result: Record<string, number> = {};
  for (const [decision, count] of pairs) {
    result[decision] = count;
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function invokeAudit<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    const result = invoke(cmd, args);
    if (result && typeof (result as Promise<T>).then === 'function') {
      return await (result as Promise<T>);
    }
    return result as T;
  } catch (err) {
    console.warn(`[notice:audit] ${cmd} failed:`, err);
    throw err;
  }
}
