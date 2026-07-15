import { appDataDir, join } from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

import type { ConfirmationInfo } from '../tools/commandSafety';
import type { MemoryType } from '../memdir/types';
import { toMemoryFilename } from '../memdir/types';
import { ContentSafetyError, evaluate, scanContent } from '../safety/contentGuard';

export type ReviewProposalStatus = 'draft' | 'accepted' | 'rejected';
export type ReviewRisk = 'medium' | 'high' | 'critical';
export type ReviewDecisionReason = 'user' | 'aborted' | 'interrupted';

export interface ReviewProposal {
  id: string;
  status: ReviewProposalStatus;
  risk: ReviewRisk;
  kind: 'publish' | 'send' | 'payment' | 'memory';
  toolName: string;
  detail: string;
  /** Process-local approval preview. Deliberately absent from the JSONL log. */
  preview?: string;
  conversationId: string;
  agentName?: string;
  memory?: {
    type: MemoryType;
    memoryPath: string;
    filename: string;
  };
  createdAt: number;
  decidedAt?: number;
  decisionReason?: ReviewDecisionReason;
}

export interface ReviewQueueSnapshot {
  initialized: boolean;
  proposals: readonly ReviewProposal[];
  error: string | null;
}

interface CreatedEvent {
  schemaVersion: 1;
  eventId: string;
  proposalId: string;
  action: 'created';
  at: number;
  proposal: Omit<ReviewProposal, 'status' | 'preview'>;
}

interface DecisionEvent {
  schemaVersion: 1;
  eventId: string;
  proposalId: string;
  action: 'accepted' | 'rejected';
  at: number;
  reason: ReviewDecisionReason;
}

type ReviewAuditEvent = CreatedEvent | DecisionEvent;

const LOG_DIRECTORY = 'review-queue';
const LOG_FILENAME = 'proposals.jsonl';
const PAYLOAD_DIRECTORY = 'payloads';
const MAX_DETAIL_LENGTH = 2_000;

interface MemoryReviewPayload {
  schemaVersion: 1;
  kind: 'memory';
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  memoryPath: string;
  filename: string;
}

let snapshot: ReviewQueueSnapshot = {
  initialized: false,
  proposals: [],
  error: null,
};
let auditEvents: ReviewAuditEvent[] = [];
let initializationPromise: Promise<void> | null = null;
let writeTail: Promise<unknown> = Promise.resolve();
const livePreviews = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function riskFor(kind: ReviewProposal['kind']): ReviewRisk {
  if (kind === 'payment') return 'critical';
  if (kind === 'publish') return 'high';
  return 'medium';
}

/** Keep the review record useful without persisting credentials or full payloads. */
export function redactReviewDetail(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|token|secret|password|passwd)["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
    .slice(0, MAX_DETAIL_LENGTH);
}

async function logPath(): Promise<string> {
  return join(await appDataDir(), LOG_DIRECTORY, LOG_FILENAME);
}

async function payloadPath(proposalId: string): Promise<string> {
  return join(await appDataDir(), LOG_DIRECTORY, PAYLOAD_DIRECTORY, `${proposalId}.json`);
}

async function readMemoryPayload(proposalId: string): Promise<MemoryReviewPayload | null> {
  const path = await payloadPath(proposalId);
  if (!(await exists(path))) return null;
  try {
    const parsed = JSON.parse(await readTextFile(path)) as Partial<MemoryReviewPayload>;
    if (parsed.schemaVersion !== 1
      || parsed.kind !== 'memory'
      || typeof parsed.name !== 'string'
      || typeof parsed.description !== 'string'
      || !['user', 'feedback', 'project', 'reference'].includes(String(parsed.type))
      || typeof parsed.content !== 'string'
      || typeof parsed.memoryPath !== 'string'
      || typeof parsed.filename !== 'string') return null;
    return parsed as MemoryReviewPayload;
  } catch {
    return null;
  }
}

async function writeMemoryPayload(proposalId: string, payload: MemoryReviewPayload): Promise<void> {
  const path = await payloadPath(proposalId);
  const directory = await join(await appDataDir(), LOG_DIRECTORY, PAYLOAD_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeTextFile(tempPath, JSON.stringify(payload));
  if (await exists(path)) await remove(path);
  await rename(tempPath, path);
}

async function removeMemoryPayload(proposalId: string): Promise<void> {
  const path = await payloadPath(proposalId);
  if (await exists(path)) await remove(path);
}

async function readLog(): Promise<string> {
  const path = await logPath();
  if (!(await exists(path))) return '';
  return readTextFile(path);
}

async function writeLog(content: string): Promise<void> {
  const path = await logPath();
  const directory = await join(await appDataDir(), LOG_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeTextFile(tempPath, content);
  if (await exists(path)) await remove(path);
  await rename(tempPath, path);
}

function isCreatedEvent(value: unknown): value is CreatedEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<CreatedEvent>;
  const proposal = event.proposal as Partial<CreatedEvent['proposal']> | undefined;
  return event.schemaVersion === 1
    && event.action === 'created'
    && typeof event.eventId === 'string'
    && typeof event.proposalId === 'string'
    && typeof event.at === 'number'
    && !!proposal
    && proposal.id === event.proposalId
    && ['medium', 'high', 'critical'].includes(String(proposal.risk))
    && ['publish', 'send', 'payment', 'memory'].includes(String(proposal.kind))
    && typeof proposal.toolName === 'string'
    && typeof proposal.detail === 'string'
    && typeof proposal.conversationId === 'string'
    && typeof proposal.createdAt === 'number'
    && (proposal.kind !== 'memory'
      || (!!proposal.memory
        && ['user', 'feedback', 'project', 'reference'].includes(String(proposal.memory.type))
        && typeof proposal.memory.memoryPath === 'string'
        && typeof proposal.memory.filename === 'string'));
}

function isDecisionEvent(value: unknown): value is DecisionEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<DecisionEvent>;
  return event.schemaVersion === 1
    && ['accepted', 'rejected'].includes(String(event.action))
    && typeof event.eventId === 'string'
    && typeof event.proposalId === 'string'
    && typeof event.at === 'number'
    && ['user', 'aborted', 'interrupted'].includes(String(event.reason));
}

function parseEvents(raw: string): ReviewAuditEvent[] {
  const events: ReviewAuditEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isCreatedEvent(parsed) || isDecisionEvent(parsed)) events.push(parsed);
    } catch {
      // A damaged line must not hide the rest of the audit trail.
    }
  }
  return events;
}

function replay(events: readonly ReviewAuditEvent[]): ReviewProposal[] {
  const proposals = new Map<string, ReviewProposal>();
  for (const event of events) {
    if (event.action === 'created') {
      if (!proposals.has(event.proposalId)) {
        proposals.set(event.proposalId, { ...event.proposal, status: 'draft' });
      }
      continue;
    }

    const proposal = proposals.get(event.proposalId);
    if (!proposal || proposal.status !== 'draft') continue;
    proposals.set(event.proposalId, {
      ...proposal,
      status: event.action,
      decidedAt: event.at,
      decisionReason: event.reason,
    });
  }
  return [...proposals.values()]
    .map((proposal) => {
      const preview = livePreviews.get(proposal.id);
      return preview ? { ...proposal, preview } : proposal;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function serialize(events: readonly ReviewAuditEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
}

async function underWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeTail.then(operation, operation);
  writeTail = result.catch(() => undefined);
  return result;
}

async function appendEvents(events: readonly ReviewAuditEvent[]): Promise<void> {
  const next = [...auditEvents, ...events];
  await writeLog(serialize(next));
  auditEvents = next;
  snapshot = { initialized: true, proposals: replay(auditEvents), error: null };
  notify();
}

export function subscribeToReviewQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReviewQueueSnapshot(): ReviewQueueSnapshot {
  return snapshot;
}

/**
 * Hydrates the durable queue. Drafts from a previous process cannot be safely
 * replayed, so they are rejected as interrupted before new work is accepted.
 */
export function initializeReviewQueue(): Promise<void> {
  if (snapshot.initialized && !snapshot.error) return Promise.resolve();
  if (initializationPromise) return initializationPromise;

  initializationPromise = underWriteLock(async () => {
    try {
      auditEvents = parseEvents(await readLog());
      const hydrated = replay(auditEvents);
      const missingPayloadIds = new Set<string>();
      for (const proposal of hydrated) {
        if (proposal.status !== 'draft' || proposal.kind !== 'memory') continue;
        const payload = await readMemoryPayload(proposal.id);
        if (payload) {
          livePreviews.set(proposal.id, redactReviewDetail(`${payload.name}\n${payload.content}`));
        } else {
          missingPayloadIds.add(proposal.id);
        }
      }
      const staleDrafts = hydrated.filter(
        (proposal) => proposal.status === 'draft'
          && (proposal.kind !== 'memory' || missingPayloadIds.has(proposal.id)),
      );
      if (staleDrafts.length > 0) {
        const at = Date.now();
        const interrupted = staleDrafts.map<DecisionEvent>((proposal) => ({
          schemaVersion: 1,
          eventId: newId('review-event'),
          proposalId: proposal.id,
          action: 'rejected',
          at,
          reason: 'interrupted',
        }));
        await appendEvents(interrupted);
      } else {
        snapshot = { initialized: true, proposals: replay(auditEvents), error: null };
        notify();
      }
    } catch (error) {
      snapshot = {
        initialized: true,
        proposals: [],
        error: error instanceof Error ? error.message : String(error),
      };
      notify();
      throw error;
    }
  });

  return initializationPromise;
}

export async function createReviewProposal(input: {
  info: ConfirmationInfo;
  conversationId: string;
  agentName?: string;
}): Promise<ReviewProposal> {
  if (input.info.kind !== 'external-action' || !input.info.externalActionKind) {
    throw new Error('Only external actions can enter the Review Queue');
  }
  const kind = input.info.externalActionKind;
  await initializeReviewQueue();
  if (snapshot.error) throw new Error(snapshot.error);

  return underWriteLock(async () => {
    const createdAt = Date.now();
    const id = newId('review');
    const proposal: Omit<ReviewProposal, 'status' | 'preview'> = {
      id,
      risk: riskFor(kind),
      kind,
      toolName: input.info.toolName ?? 'unknown',
      detail: redactReviewDetail(input.info.command),
      conversationId: input.conversationId,
      ...(input.agentName ? { agentName: input.agentName } : {}),
      createdAt,
    };
    livePreviews.set(id, redactReviewDetail(input.info.reviewPayload ?? input.info.command));
    try {
      await appendEvents([{
        schemaVersion: 1,
        eventId: newId('review-event'),
        proposalId: id,
        action: 'created',
        at: createdAt,
        proposal,
      }]);
    } catch (error) {
      livePreviews.delete(id);
      throw error;
    }
    return { ...proposal, status: 'draft', preview: livePreviews.get(id) };
  });
}

export async function createMemoryReviewProposal(input: {
  conversationId: string;
  agentName: string;
  memoryPath: string;
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  replaces?: string;
}): Promise<ReviewProposal> {
  const scan = scanContent(input.content);
  if (evaluate(scan, 'memory') === 'block') throw new ContentSafetyError(scan, 'memory');

  await initializeReviewQueue();
  if (snapshot.error) throw new Error(snapshot.error);

  return underWriteLock(async () => {
    const createdAt = Date.now();
    const id = newId('review');
    const filename = input.replaces || toMemoryFilename(input.type, input.name);
    const proposal: Omit<ReviewProposal, 'status' | 'preview'> = {
      id,
      risk: 'medium',
      kind: 'memory',
      toolName: 'employee-memory',
      detail: redactReviewDetail(`Memory: ${input.name}`),
      conversationId: input.conversationId,
      agentName: input.agentName,
      memory: { type: input.type, memoryPath: input.memoryPath, filename },
      createdAt,
    };
    const payload: MemoryReviewPayload = {
      schemaVersion: 1,
      kind: 'memory',
      name: input.name,
      description: input.description,
      type: input.type,
      content: input.content,
      memoryPath: input.memoryPath,
      filename,
    };
    livePreviews.set(id, redactReviewDetail(`${input.name}\n${input.content}`));
    try {
      await writeMemoryPayload(id, payload);
      await appendEvents([{
        schemaVersion: 1,
        eventId: newId('review-event'),
        proposalId: id,
        action: 'created',
        at: createdAt,
        proposal,
      }]);
    } catch (error) {
      livePreviews.delete(id);
      await removeMemoryPayload(id).catch(() => {});
      throw error;
    }
    return { ...proposal, status: 'draft', preview: livePreviews.get(id) };
  });
}

export async function decideReviewProposal(
  proposalId: string,
  accepted: boolean,
  reason: ReviewDecisionReason = 'user',
): Promise<boolean> {
  await initializeReviewQueue();
  if (snapshot.error) return false;

  return underWriteLock(async () => {
    const proposal = snapshot.proposals.find((item) => item.id === proposalId);
    if (!proposal || proposal.status !== 'draft') return false;
    if (proposal.kind === 'memory') return false;
    await appendEvents([{
      schemaVersion: 1,
      eventId: newId('review-event'),
      proposalId,
      action: accepted ? 'accepted' : 'rejected',
      at: Date.now(),
      reason,
    }]);
    return true;
  });
}

export async function resolveMemoryReviewProposal(
  proposalId: string,
  accepted: boolean,
): Promise<boolean> {
  await initializeReviewQueue();
  if (snapshot.error) return false;

  return underWriteLock(async () => {
    const proposal = snapshot.proposals.find((item) => item.id === proposalId);
    if (!proposal || proposal.status !== 'draft' || proposal.kind !== 'memory') return false;
    const payload = await readMemoryPayload(proposalId);
    if (!payload) return false;

    if (accepted) {
      const { writeMemory } = await import('../memdir/write');
      await writeMemory({
        name: payload.name,
        description: payload.description,
        type: payload.type,
        content: payload.content,
        source: 'auto_flush',
        workspacePath: payload.memoryPath,
        filename: payload.filename,
      });
    }

    const preview = livePreviews.get(proposalId);
    livePreviews.delete(proposalId);
    try {
      await appendEvents([{
        schemaVersion: 1,
        eventId: newId('review-event'),
        proposalId,
        action: accepted ? 'accepted' : 'rejected',
        at: Date.now(),
        reason: 'user',
      }]);
    } catch (error) {
      if (preview) livePreviews.set(proposalId, preview);
      throw error;
    }
    await removeMemoryPayload(proposalId).catch(() => {});
    return true;
  });
}

export function getReviewProposal(proposalId: string): ReviewProposal | undefined {
  return snapshot.proposals.find((proposal) => proposal.id === proposalId);
}

/** Test-only reset; production callers should hydrate once per app process. */
export function resetReviewQueueForTests(): void {
  snapshot = { initialized: false, proposals: [], error: null };
  auditEvents = [];
  livePreviews.clear();
  initializationPromise = null;
  writeTail = Promise.resolve();
  listeners.clear();
}
