/**
 * Execution Ledger — reports what a digital employee actually did back to the
 * platform, closing the accountability loop ("有人负责").
 *
 * Before this, a digital employee ran entirely locally and the platform had
 * zero visibility into its work — the core "证据账本" selling point was hollow.
 * This module subscribes to the existing `agentEnd` lifecycle hook, reads the
 * completed run's TaskExecution, and reports a compact, DESENSITIZED summary.
 *
 * Privacy (Fuyao CLAUDE.md telemetry red-line — opt-in + server-relay + 脱敏):
 * - Opt-in: does nothing unless a platform endpoint is configured.
 * - Desensitized by construction: sends only metadata — employee name, token
 *   counts, per-type step counts, tool names, artifact BASENAMES, outcome.
 *   Never raw tool inputs/outputs, model keys, message content, or full local
 *   paths (which would leak the user's directory / username).
 *
 * ponytail: first slice is best-effort POST only. A durable local ledger with
 * offline retry is a follow-up — add when reliability of delivery matters.
 */
import { registerHook, type AgentEndEvent } from '../agent/lifecycleHooks';
import { useTaskExecutionStore } from '@/stores/taskExecutionStore';
import { useLedgerStore } from '@/stores/ledgerStore';
import { getBaseName } from '@/utils/pathUtils';
import type { TaskExecution, ExecutionStep, StepType } from '@/types/execution';

/** Wire-contract version so the platform ingest can evolve the shape safely. */
export const LEDGER_SCHEMA_VERSION = 1;

/** The built-in assistant is not a digital employee — its runs are not reported. */
export const DEFAULT_ASSISTANT_NAME = 'abu';

/** Desensitized record of one completed employee run, sent to the platform. */
export interface EmployeeExecutionLedgerEntry {
  schemaVersion: number;
  employeeName: string;
  loopId: string;
  conversationId: string;
  /** Loop exit reason (end_turn / max_turns / error / aborted / ...). */
  outcome: string;
  /** Execution status if the run record was found. */
  status?: TaskExecution['status'];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number };
  steps: { total: number; completed: number; errors: number; byType: Partial<Record<StepType, number>> };
  /** Distinct tool identities used — names only, never arguments. */
  toolsUsed: string[];
  /** Basenames of files the employee wrote/created — evidence without leaking paths. */
  artifacts: string[];
}

export type LedgerReportResult = 'sent' | 'skipped' | 'failed';

const ARTIFACT_STEP_TYPES: ReadonlySet<StepType> = new Set<StepType>(['file-write', 'file-create']);
const PATH_KEYS = ['path', 'file_path', 'filePath', 'file', 'target'] as const;

function extractPath(input: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/**
 * Build a desensitized ledger entry from a completed run. Pure — no I/O.
 * `execution` may be undefined if the run record was already evicted; the entry
 * still captures identity, outcome and timing from the event.
 */
export function buildLedgerEntry(
  event: AgentEndEvent,
  execution: TaskExecution | undefined,
): EmployeeExecutionLedgerEntry {
  const steps: ExecutionStep[] = execution?.steps ?? [];

  const byType: Partial<Record<StepType, number>> = {};
  const tools = new Set<string>();
  const artifacts = new Set<string>();
  let completed = 0;
  let errors = 0;

  for (const step of steps) {
    byType[step.type] = (byType[step.type] ?? 0) + 1;
    if (step.status === 'completed') completed += 1;
    else if (step.status === 'error') errors += 1;
    if (step.toolName?.trim()) tools.add(step.toolName);
    if (ARTIFACT_STEP_TYPES.has(step.type)) {
      const p = extractPath(step.toolInput ?? {});
      if (p) artifacts.add(getBaseName(p));
    }
  }

  const startedAt = execution?.startTime ?? event.timestamp;
  const finishedAt = execution?.endTime ?? event.timestamp;
  const usage = execution?.usage;

  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    employeeName: event.agentName,
    loopId: event.loopId,
    conversationId: event.conversationId ?? '',
    outcome: event.reason,
    status: execution?.status,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    tokenUsage: {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      ...(usage?.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: usage.cacheReadInputTokens } : {}),
    },
    steps: { total: steps.length, completed, errors, byType },
    toolsUsed: [...tools],
    artifacts: [...artifacts],
  };
}

/** True for real digital employees; false for the built-in assistant / anonymous runs. */
export function isReportableEmployee(agentName: string | undefined): boolean {
  return !!agentName && agentName.trim().length > 0 && agentName !== DEFAULT_ASSISTANT_NAME;
}

/**
 * Best-effort POST to the platform ledger. No-op (returns 'skipped') when no
 * endpoint is configured — this is the opt-in gate. Never throws.
 */
export async function reportToPlatformLedger(
  entry: EmployeeExecutionLedgerEntry,
  endpoint: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<LedgerReportResult> {
  if (!endpoint || !endpoint.trim()) return 'skipped';
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Register the ledger on the `agentEnd` hook. On each completed employee run it
 * builds a desensitized entry and hands it to `record` (the durable ledger
 * store owns persistence + reporting + retry). Returns an unregister function.
 * Dependencies are injectable for testing; defaults wire the real store.
 */
export function initExecutionLedger(opts: {
  record: (entry: EmployeeExecutionLedgerEntry) => void | Promise<void>;
  getExecution?: (loopId: string) => TaskExecution | undefined;
  isReportable?: (agentName: string | undefined) => boolean;
}): () => void {
  const getExecution =
    opts.getExecution ?? ((loopId: string) => useTaskExecutionStore.getState().getExecutionByLoopId(loopId));
  const reportable = opts.isReportable ?? isReportableEmployee;

  return registerHook<AgentEndEvent>('agentEnd', async (event) => {
    if (!reportable(event.agentName)) return;
    const entry = buildLedgerEntry(event, getExecution(event.loopId));
    await opts.record(entry);
  });
}

let started = false;
/** Retry pending ledger records every 5 minutes (transient failure / late config). */
export const RETRY_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Default startup wiring. Opt-in via VITE_PLATFORM_LEDGER_ENDPOINT (unset =
 * reports are skipped but records still accrue locally, mirroring the Langfuse
 * observability pattern). Idempotent.
 * ponytail: env-based endpoint for now; move to platform key-custody config
 * (Q1) when the relay is built.
 */
export function startExecutionLedger(): () => void {
  if (started) return () => {};
  started = true;
  const report = (entry: EmployeeExecutionLedgerEntry) =>
    reportToPlatformLedger(entry, import.meta.env.VITE_PLATFORM_LEDGER_ENDPOINT as string | undefined);
  const unregister = initExecutionLedger({
    record: (entry) => {
      useLedgerStore.getState().append(entry);
      void useLedgerStore.getState().flush(report);
    },
  });
  // Flush anything persisted from a previous session, then retry periodically.
  void useLedgerStore.getState().flush(report);
  const interval = setInterval(() => void useLedgerStore.getState().flush(report), RETRY_INTERVAL_MS);
  return () => {
    started = false;
    clearInterval(interval);
    unregister();
  };
}
