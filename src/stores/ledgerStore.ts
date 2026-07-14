import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EmployeeExecutionLedgerEntry, LedgerReportResult } from '@/core/employee/executionLedger';

/**
 * Local durable account of digital-employee execution ledger entries + offline
 * retry queue. Each completed employee run is appended here (survives restarts
 * via persist), then reported to the platform best-effort. A run that fails to
 * report (offline / platform down) stays `pending` and is retried; it is never
 * silently lost — this is the durability the命门 first slice deferred.
 *
 * A record's lifecycle: pending → sent (platform acked) | dead (gave up after
 * MAX_ATTEMPTS). `skipped` reports (no endpoint configured) keep it pending and
 * do NOT burn an attempt — an opt-out user still accrues a local account that
 * flushes once an endpoint is set.
 */

export type LedgerRecordStatus = 'pending' | 'sent' | 'dead';

export interface LedgerRecord {
  entry: EmployeeExecutionLedgerEntry;
  status: LedgerRecordStatus;
  attempts: number;
  firstAt: number;
  lastAttemptAt?: number;
}

/** Give up reporting after this many failed attempts (record → dead). */
export const MAX_ATTEMPTS = 5;
/** Cap the local account so persisted storage can't grow unbounded. */
export const MAX_RECORDS = 1000;

interface LedgerState {
  records: LedgerRecord[];
}

interface LedgerActions {
  /** Append a freshly completed run as a pending record (pruned to MAX_RECORDS). */
  append: (entry: EmployeeExecutionLedgerEntry, now?: number) => void;
  /**
   * Attempt to report every pending record via `report`. Serialized: a second
   * concurrent flush is a no-op. Returns final-state counts.
   */
  flush: (
    report: (entry: EmployeeExecutionLedgerEntry) => Promise<LedgerReportResult>,
    now?: number,
  ) => Promise<{ sent: number; pending: number; dead: number }>;
  pendingCount: () => number;
}

/** Drop oldest sent/dead records first (never a pending one unless all are). */
function prune(records: LedgerRecord[]): LedgerRecord[] {
  if (records.length <= MAX_RECORDS) return records;
  const excess = records.length - MAX_RECORDS;
  const droppable = new Set(records.filter((r) => r.status !== 'pending').slice(0, excess));
  let remaining = records.filter((r) => !droppable.has(r));
  if (remaining.length > MAX_RECORDS) remaining = remaining.slice(remaining.length - MAX_RECORDS);
  return remaining;
}

// Serialize flushes — the retry interval and per-run flush must not overlap and
// clobber each other's state writes. ponytail: module boolean, not a lock lib.
let flushing = false;

export const useLedgerStore = create<LedgerState & LedgerActions>()(
  persist(
    (set, get) => ({
      records: [],

      append: (entry, now = Date.now()) =>
        set((state) => ({
          records: prune([...state.records, { entry, status: 'pending', attempts: 0, firstAt: now }]),
        })),

      flush: async (report, now = Date.now()) => {
        if (flushing) {
          const p = get().pendingCount();
          return { sent: 0, pending: p, dead: 0 };
        }
        flushing = true;
        try {
          const pending = get().records.filter((r) => r.status === 'pending');
          const updates = new Map<string, { status: LedgerRecordStatus; attempts: number; lastAttemptAt: number }>();
          for (const rec of pending) {
            const result = await report(rec.entry);
            if (result === 'sent') {
              updates.set(rec.entry.loopId, { status: 'sent', attempts: rec.attempts, lastAttemptAt: now });
            } else if (result === 'failed') {
              const attempts = rec.attempts + 1;
              updates.set(rec.entry.loopId, {
                status: attempts >= MAX_ATTEMPTS ? 'dead' : 'pending',
                attempts,
                lastAttemptAt: now,
              });
            }
            // 'skipped' (no endpoint) → leave pending, no attempt burned.
          }
          // Match by loopId against the CURRENT records so appends during flush survive.
          set((state) => ({
            records: state.records.map((r) => {
              const u = updates.get(r.entry.loopId);
              return u ? { ...r, ...u } : r;
            }),
          }));
          let sent = 0, pendingN = 0, dead = 0;
          for (const r of get().records) {
            if (r.status === 'sent') sent++;
            else if (r.status === 'dead') dead++;
            else pendingN++;
          }
          return { sent, pending: pendingN, dead };
        } finally {
          flushing = false;
        }
      },

      pendingCount: () => get().records.filter((r) => r.status === 'pending').length,
    }),
    {
      name: 'abu-employee-ledger',
      version: 1,
      partialize: (state) => ({ records: state.records }),
    },
  ),
);

/** Test-only: reset the module-level flush guard. */
export function __resetFlushGuard(): void {
  flushing = false;
}
