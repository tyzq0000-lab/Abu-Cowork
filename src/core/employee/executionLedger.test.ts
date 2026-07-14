import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildLedgerEntry,
  reportToPlatformLedger,
  isReportableEmployee,
  initExecutionLedger,
  LEDGER_SCHEMA_VERSION,
  type EmployeeExecutionLedgerEntry,
} from './executionLedger';
import { emitHook, clearAllHooks, type AgentEndEvent } from '../agent/lifecycleHooks';
import type { TaskExecution, ExecutionStep, StepType } from '@/types/execution';

function step(type: StepType, over: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 's', executionId: 'e', type, label: '', status: 'completed',
    toolName: '', toolInput: {}, source: 'agent', detailBlocks: [], ...over,
  };
}

function execution(over: Partial<TaskExecution> = {}): TaskExecution {
  return {
    id: 'e1', conversationId: 'c1', loopId: 'L1', status: 'completed',
    startTime: 1000, endTime: 4000, plannedSteps: [], planParsed: false, steps: [], ...over,
  };
}

const endEvent = (over: Partial<AgentEndEvent> = {}): AgentEndEvent => ({
  type: 'agentEnd', timestamp: 4000, conversationId: 'c1',
  agentName: 'growth-operator', loopId: 'L1', reason: 'end_turn', ...over,
});

describe('buildLedgerEntry', () => {
  it('summarizes a run into a desensitized entry', () => {
    const exec = execution({
      usage: { inputTokens: 1200, outputTokens: 340, cacheReadInputTokens: 800 },
      steps: [
        step('command', { toolName: 'run_command', status: 'completed' }),
        step('file-create', { toolName: 'write_file', toolInput: { path: 'reports/2026/summary.docx' } }),
        step('file-write', { toolName: 'write_file', toolInput: { file_path: 'C:/Users/alice/out/chart.png' } }),
        step('search', { toolName: 'run_command', status: 'error' }), // dup tool name
        step('thinking'),
      ],
    });
    const e = buildLedgerEntry(endEvent(), exec);

    expect(e.schemaVersion).toBe(LEDGER_SCHEMA_VERSION);
    expect(e.employeeName).toBe('growth-operator');
    expect(e.outcome).toBe('end_turn');
    expect(e.durationMs).toBe(3000);
    expect(e.tokenUsage).toEqual({ inputTokens: 1200, outputTokens: 340, cacheReadInputTokens: 800 });
    expect(e.steps.total).toBe(5);
    expect(e.steps.errors).toBe(1);
    expect(e.steps.byType).toMatchObject({ command: 1, 'file-create': 1, 'file-write': 1, search: 1, thinking: 1 });
    expect(e.toolsUsed.sort()).toEqual(['run_command', 'write_file']); // distinct, names only
    expect(e.artifacts.sort()).toEqual(['chart.png', 'summary.docx']); // basenames, no full path
  });

  it('leaks no full paths (privacy)', () => {
    const e = buildLedgerEntry(endEvent(), execution({
      steps: [step('file-write', { toolInput: { path: 'C:/Users/alice/secret/report.xlsx' } })],
    }));
    expect(e.artifacts).toEqual(['report.xlsx']);
    expect(JSON.stringify(e)).not.toContain('alice');
  });

  it('falls back to event timing/zero usage when the run record is gone', () => {
    const e = buildLedgerEntry(endEvent({ timestamp: 5000 }), undefined);
    expect(e.startedAt).toBe(5000);
    expect(e.finishedAt).toBe(5000);
    expect(e.durationMs).toBe(0);
    expect(e.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(e.steps.total).toBe(0);
  });
});

describe('isReportableEmployee', () => {
  it('reports named employees, skips the built-in assistant and anonymous', () => {
    expect(isReportableEmployee('growth-operator')).toBe(true);
    expect(isReportableEmployee('abu')).toBe(false);
    expect(isReportableEmployee('')).toBe(false);
    expect(isReportableEmployee(undefined)).toBe(false);
  });
});

describe('reportToPlatformLedger', () => {
  const entry = { schemaVersion: 1, employeeName: 'x' } as EmployeeExecutionLedgerEntry;

  it('is opt-in: no endpoint => skipped, fetch never called', async () => {
    const f = vi.fn();
    expect(await reportToPlatformLedger(entry, undefined, { fetchImpl: f as unknown as typeof fetch })).toBe('skipped');
    expect(await reportToPlatformLedger(entry, '   ', { fetchImpl: f as unknown as typeof fetch })).toBe('skipped');
    expect(f).not.toHaveBeenCalled();
  });

  it('sent on ok, failed on non-ok, failed on throw', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true });
    expect(await reportToPlatformLedger(entry, 'https://p/ledger', { fetchImpl: ok as unknown as typeof fetch })).toBe('sent');
    const bad = vi.fn().mockResolvedValue({ ok: false });
    expect(await reportToPlatformLedger(entry, 'https://p/ledger', { fetchImpl: bad as unknown as typeof fetch })).toBe('failed');
    const boom = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await reportToPlatformLedger(entry, 'https://p/ledger', { fetchImpl: boom as unknown as typeof fetch })).toBe('failed');
  });

  it('sends Authorization: Bearer when a token is configured', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    await reportToPlatformLedger(entry, 'https://p/ledger', { token: 'secret', fetchImpl: f as unknown as typeof fetch });
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret');
  });
});

describe('initExecutionLedger (agentEnd hook wiring)', () => {
  beforeEach(() => clearAllHooks());

  it('hands an employee run to the record sink', async () => {
    const record = vi.fn();
    initExecutionLedger({
      record,
      getExecution: () => execution({ usage: { inputTokens: 10, outputTokens: 5 } }),
    });
    await emitHook(endEvent());
    expect(record).toHaveBeenCalledOnce();
    const entry = record.mock.calls[0][0] as EmployeeExecutionLedgerEntry;
    expect(entry.employeeName).toBe('growth-operator');
    expect(entry.tokenUsage.inputTokens).toBe(10);
  });

  it('does not record the built-in assistant', async () => {
    const record = vi.fn();
    initExecutionLedger({ record, getExecution: () => execution() });
    await emitHook(endEvent({ agentName: 'abu' }));
    expect(record).not.toHaveBeenCalled();
  });
});
