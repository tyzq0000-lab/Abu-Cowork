import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildLedgerEntry,
  reportToPlatformLedger,
  isReportableEmployee,
  initExecutionLedger,
  resolveEmployeeId,
  resolveLedgerDeployment,
  reportEmployeeLedgerEntry,
  LEDGER_SCHEMA_VERSION,
  type EmployeeExecutionLedgerEntry,
} from './executionLedger';
import { emitHook, clearAllHooks, type AgentEndEvent } from '../agent/lifecycleHooks';
import type { EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';
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

  it('carries the platform employee id when provided, omits the key otherwise', () => {
    expect(buildLedgerEntry(endEvent(), undefined, 'emp_123').employeeId).toBe('emp_123');
    expect('employeeId' in buildLedgerEntry(endEvent(), undefined)).toBe(false);
  });
});

describe('resolveEmployeeId (agentName → platform id via deployment records)', () => {
  const dep = (over: Partial<EmployeeDeploymentRecord>): EmployeeDeploymentRecord => ({
    packageId: 'pkg', agentName: 'growth-operator', workspacePath: null, configuredAt: 1, ...over,
  });

  it('resolves the id recorded at deep-link deployment', () => {
    const deployments = {
      pkgA: dep({ packageId: 'pkgA', employeeId: 'emp_123' }),
      pkgB: dep({ packageId: 'pkgB', agentName: 'other-agent', employeeId: 'emp_999' }),
    };
    expect(resolveEmployeeId('growth-operator', deployments)).toBe('emp_123');
  });

  it('prefers the most recently configured record with an id', () => {
    const deployments = {
      old: dep({ packageId: 'old', employeeId: 'emp_old', configuredAt: 1 }),
      neu: dep({ packageId: 'neu', employeeId: 'emp_new', configuredAt: 2 }),
      noid: dep({ packageId: 'noid', configuredAt: 3 }), // manual install: no id, never wins
    };
    expect(resolveEmployeeId('growth-operator', deployments)).toBe('emp_new');
  });

  it('uses the exact conversation binding before the latest same-name deployment', () => {
    const deployments = {
      companyA: dep({ packageId: 'a', employeeId: 'emp_a', conversationId: 'c1', configuredAt: 1 }),
      companyB: dep({ packageId: 'b', employeeId: 'emp_b', conversationId: 'c2', configuredAt: 2 }),
    };
    expect(resolveEmployeeId('growth-operator', deployments, 'c1')).toBe('emp_a');
  });

  it('undefined for unknown agents or id-less deployments', () => {
    expect(resolveEmployeeId('growth-operator', {})).toBeUndefined();
    expect(resolveEmployeeId('growth-operator', { p: dep({}) })).toBeUndefined();
  });
});

describe('per-deployment ledger routing', () => {
  const deployment = (over: Partial<EmployeeDeploymentRecord> = {}): EmployeeDeploymentRecord => ({
    packageId: 'pkg',
    employeeId: 'emp_123',
    deploymentId: 'dep_11111111111111111111111111111111',
    ledgerEndpoint: 'https://uprow.example.com/api/ledger',
    agentName: 'growth-operator',
    workspacePath: null,
    configuredAt: 1,
    ...over,
  });
  const entry = buildLedgerEntry(endEvent(), execution(), 'emp_123');

  it('resolves by employee id and prefers the newest binding', () => {
    const records = {
      old: deployment({ packageId: 'old', configuredAt: 1 }),
      latest: deployment({ packageId: 'latest', configuredAt: 2 }),
      other: deployment({ packageId: 'other', employeeId: 'emp_other', configuredAt: 3 }),
    };
    expect(resolveLedgerDeployment(entry, records)?.packageId).toBe('latest');
  });

  it('routes by conversation before employee id when two tenants deploy the same employee', () => {
    const records = {
      companyA: deployment({ packageId: 'company-a', conversationId: 'c1', configuredAt: 1 }),
      companyB: deployment({ packageId: 'company-b', conversationId: 'c2', configuredAt: 2 }),
    };
    expect(resolveLedgerDeployment(entry, records)?.packageId).toBe('company-a');
  });

  it('uses the deployment endpoint and OS-keyring bearer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const result = await reportEmployeeLedgerEntry(entry, { pkg: deployment() }, {
      getSecretImpl: vi.fn().mockResolvedValue('device-secret'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      legacyEndpoint: 'https://legacy.example.com/ledger',
      legacyToken: 'legacy-secret',
    });
    expect(result).toBe('sent');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://uprow.example.com/api/ledger');
    expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>).Authorization)
      .toBe('Bearer device-secret');
  });

  it('never falls back to the shared token when a bound credential is missing', async () => {
    const fetchImpl = vi.fn();
    expect(await reportEmployeeLedgerEntry(entry, { pkg: deployment() }, {
      getSecretImpl: vi.fn().mockResolvedValue(null),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      legacyEndpoint: 'https://legacy.example.com/ledger',
      legacyToken: 'legacy-secret',
    })).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the legacy opt-in path for non-platform installs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const manualEntry = buildLedgerEntry(endEvent(), execution());
    expect(await reportEmployeeLedgerEntry(manualEntry, {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      legacyEndpoint: 'https://legacy.example.com/ledger',
      legacyToken: 'legacy-secret',
    })).toBe('sent');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://legacy.example.com/ledger');
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

  it('stamps the resolved platform employee id onto the entry', async () => {
    const record = vi.fn();
    initExecutionLedger({
      record,
      getExecution: () => execution(),
      resolveEmployeeId: (name) => (name === 'growth-operator' ? 'emp_123' : undefined),
    });
    await emitHook(endEvent());
    expect((record.mock.calls[0][0] as EmployeeExecutionLedgerEntry).employeeId).toBe('emp_123');
  });

  it('does not record the built-in assistant', async () => {
    const record = vi.fn();
    initExecutionLedger({ record, getExecution: () => execution() });
    await emitHook(endEvent({ agentName: 'abu' }));
    expect(record).not.toHaveBeenCalled();
  });
});
