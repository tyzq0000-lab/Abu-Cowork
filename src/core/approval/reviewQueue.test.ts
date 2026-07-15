import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({ files: new Map<string, string>() }));
const memoryMocks = vi.hoisted(() => ({ write: vi.fn(async () => 'feedback_growth.md') }));

vi.mock('../memdir/write', () => ({ writeMemory: memoryMocks.write }));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: async () => '/app-data',
  join: async (...parts: string[]) => parts.join('/'),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (path: string) => fsState.files.has(path),
  mkdir: async () => undefined,
  readTextFile: async (path: string) => {
    const value = fsState.files.get(path);
    if (value === undefined) throw new Error('not found');
    return value;
  },
  remove: async (path: string) => { fsState.files.delete(path) },
  rename: async (from: string, to: string) => {
    const value = fsState.files.get(from);
    if (value === undefined) throw new Error('not found');
    fsState.files.set(to, value);
    fsState.files.delete(from);
  },
  writeTextFile: async (path: string, value: string) => { fsState.files.set(path, value) },
}));

import {
  createReviewProposal,
  createMemoryReviewProposal,
  decideReviewProposal,
  getReviewQueueSnapshot,
  initializeReviewQueue,
  resolveMemoryReviewProposal,
  resetReviewQueueForTests,
} from './reviewQueue';

const EXTERNAL_ACTION = {
  command: 'POST https://example.com/send',
  level: 'danger' as const,
  reason: 'requires approval',
  kind: 'external-action' as const,
  externalActionKind: 'send' as const,
  toolName: 'run_command',
  reviewPayload: 'curl -H "Authorization: Bearer top-secret" "https://example.com/send?token=query-secret" --data \'{"title":"季度复盘","token":"json-secret"}\'',
};

describe('Review Queue', () => {
  beforeEach(() => {
    fsState.files.clear();
    memoryMocks.write.mockClear();
    resetReviewQueueForTests();
  });

  it('persists a redacted draft and its accepted decision in one audit log', async () => {
    const proposal = await createReviewProposal({
      info: EXTERNAL_ACTION,
      conversationId: 'conversation-1',
      agentName: 'publisher',
    });

    expect(proposal.status).toBe('draft');
    expect(proposal.risk).toBe('medium');
    expect(proposal.preview).not.toContain('top-secret');
    expect(proposal.preview).not.toContain('query-secret');
    expect(proposal.preview).not.toContain('json-secret');
    expect(proposal.preview).toContain('[REDACTED]');

    await expect(decideReviewProposal(proposal.id, true)).resolves.toBe(true);
    expect(getReviewQueueSnapshot().proposals[0]).toMatchObject({
      id: proposal.id,
      status: 'accepted',
      decisionReason: 'user',
    });

    const log = fsState.files.get('/app-data/review-queue/proposals.jsonl') ?? '';
    expect(log.trim().split('\n')).toHaveLength(2);
    expect(log).not.toContain('季度复盘');
  });

  it('maps publishing and payment to higher risk levels', async () => {
    const publishing = await createReviewProposal({
      info: { ...EXTERNAL_ACTION, externalActionKind: 'publish' },
      conversationId: 'conversation-1',
    });
    const payment = await createReviewProposal({
      info: { ...EXTERNAL_ACTION, externalActionKind: 'payment' },
      conversationId: 'conversation-1',
    });

    expect(publishing.risk).toBe('high');
    expect(payment.risk).toBe('critical');
  });

  it('rejects drafts left by a previous process as interrupted', async () => {
    const proposal = await createReviewProposal({
      info: EXTERNAL_ACTION,
      conversationId: 'conversation-1',
    });

    resetReviewQueueForTests();
    await initializeReviewQueue();

    expect(getReviewQueueSnapshot().proposals[0]).toMatchObject({
      id: proposal.id,
      status: 'rejected',
      decisionReason: 'interrupted',
    });
  });

  it('ignores a damaged JSONL row without hiding valid proposals', async () => {
    await createReviewProposal({ info: EXTERNAL_ACTION, conversationId: 'conversation-1' });
    const path = '/app-data/review-queue/proposals.jsonl';
    fsState.files.set(path, `{not-json}\n${fsState.files.get(path) ?? ''}`);

    resetReviewQueueForTests();
    await initializeReviewQueue();

    expect(getReviewQueueSnapshot().proposals).toHaveLength(1);
  });

  it('keeps memory proposals reviewable across restart and applies only after approval', async () => {
    const proposal = await createMemoryReviewProposal({
      conversationId: 'conversation-1',
      agentName: 'account-manager',
      memoryPath: 'uprow-employee-memory://deployment/dep_a/project/client',
      name: '客户确认偏好',
      description: '客户偏好先看摘要',
      type: 'feedback',
      content: '客户要求所有周报先提供三行摘要，再附详细证据。',
    });
    expect(proposal.kind).toBe('memory');
    expect(memoryMocks.write).not.toHaveBeenCalled();

    resetReviewQueueForTests();
    await initializeReviewQueue();
    expect(getReviewQueueSnapshot().proposals[0]).toMatchObject({
      id: proposal.id,
      status: 'draft',
      kind: 'memory',
    });
    expect(getReviewQueueSnapshot().proposals[0]?.preview).toContain('三行摘要');

    await expect(resolveMemoryReviewProposal(proposal.id, true)).resolves.toBe(true);
    expect(memoryMocks.write).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: 'uprow-employee-memory://deployment/dep_a/project/client',
      type: 'feedback',
    }));
    expect(getReviewQueueSnapshot().proposals[0]?.status).toBe('accepted');
    expect([...fsState.files.keys()].some((path) => path.includes(`/payloads/${proposal.id}.json`)))
      .toBe(false);
  });

  it('rejects a memory proposal without writing its payload to memdir', async () => {
    const proposal = await createMemoryReviewProposal({
      conversationId: 'conversation-1',
      agentName: 'account-manager',
      memoryPath: 'uprow-employee-memory://local/account-manager/user',
      name: '不用保存',
      description: '不用保存',
      type: 'project',
      content: '这条候选记忆应被拒绝。',
    });

    await expect(resolveMemoryReviewProposal(proposal.id, false)).resolves.toBe(true);
    expect(memoryMocks.write).not.toHaveBeenCalled();
    expect(getReviewQueueSnapshot().proposals[0]?.status).toBe('rejected');
  });
});
