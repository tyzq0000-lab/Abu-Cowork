import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLedgerStore, MAX_ATTEMPTS, MAX_RECORDS, __resetFlushGuard } from './ledgerStore';
import type { EmployeeExecutionLedgerEntry } from '@/core/employee/executionLedger';

function entry(loopId: string): EmployeeExecutionLedgerEntry {
  return {
    schemaVersion: 1, employeeName: 'e', loopId, conversationId: 'c', outcome: 'end_turn',
    startedAt: 0, finishedAt: 0, durationMs: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 },
    steps: { total: 0, completed: 0, errors: 0, byType: {} }, toolsUsed: [], artifacts: [],
  };
}

beforeEach(() => {
  useLedgerStore.setState({ records: [] });
  __resetFlushGuard();
});

describe('ledgerStore.append', () => {
  it('appends a pending record', () => {
    useLedgerStore.getState().append(entry('L1'), 100);
    const recs = useLedgerStore.getState().records;
    expect(recs).toHaveLength(1);
    expect(recs[0].status).toBe('pending');
    expect(recs[0].firstAt).toBe(100);
    expect(useLedgerStore.getState().pendingCount()).toBe(1);
  });

  it('caps the local account at MAX_RECORDS', () => {
    for (let i = 0; i < MAX_RECORDS + 5; i++) useLedgerStore.getState().append(entry('L' + i));
    expect(useLedgerStore.getState().records).toHaveLength(MAX_RECORDS);
  });
});

describe('ledgerStore.flush', () => {
  it('marks sent on success and clears pending', async () => {
    useLedgerStore.getState().append(entry('L1'));
    const report = vi.fn().mockResolvedValue('sent');
    const counts = await useLedgerStore.getState().flush(report, 200);
    expect(report).toHaveBeenCalledOnce();
    expect(useLedgerStore.getState().records[0].status).toBe('sent');
    expect(useLedgerStore.getState().records[0].lastAttemptAt).toBe(200);
    expect(counts).toMatchObject({ sent: 1, pending: 0, dead: 0 });
  });

  it('keeps pending on skipped without burning an attempt (opt-out)', async () => {
    useLedgerStore.getState().append(entry('L1'));
    await useLedgerStore.getState().flush(vi.fn().mockResolvedValue('skipped'));
    const r = useLedgerStore.getState().records[0];
    expect(r.status).toBe('pending');
    expect(r.attempts).toBe(0);
  });

  it('increments attempts on failure and dies after MAX_ATTEMPTS, then stops retrying', async () => {
    useLedgerStore.getState().append(entry('L1'));
    const report = vi.fn().mockResolvedValue('failed');
    for (let i = 0; i < MAX_ATTEMPTS; i++) await useLedgerStore.getState().flush(report);
    const r = useLedgerStore.getState().records[0];
    expect(r.attempts).toBe(MAX_ATTEMPTS);
    expect(r.status).toBe('dead');

    report.mockClear();
    await useLedgerStore.getState().flush(report);
    expect(report).not.toHaveBeenCalled(); // dead records are not retried
  });

  it('only reports pending records', async () => {
    useLedgerStore.getState().append(entry('L1'));
    useLedgerStore.getState().append(entry('L2'));
    const report = vi.fn().mockResolvedValue('sent');
    await useLedgerStore.getState().flush(report);
    expect(report).toHaveBeenCalledTimes(2);

    report.mockClear();
    await useLedgerStore.getState().flush(report);
    expect(report).not.toHaveBeenCalled();
  });
});
