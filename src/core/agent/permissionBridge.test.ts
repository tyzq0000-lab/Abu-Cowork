import { beforeEach, describe, expect, it, vi } from 'vitest';

const reviewQueueMocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'review-test' })),
  decide: vi.fn(async () => true),
  get: vi.fn(() => undefined),
  resolveMemory: vi.fn(async () => true),
}));

vi.mock('../approval/reviewQueue', () => ({
  createReviewProposal: reviewQueueMocks.create,
  decideReviewProposal: reviewQueueMocks.decide,
  getReviewProposal: reviewQueueMocks.get,
  resolveMemoryReviewProposal: reviewQueueMocks.resolveMemory,
}));
import {
  clearLoopContext,
  getPendingCommandConfirmation,
  requestCommandConfirmation,
  resolveCommandConfirmation,
  resolveReviewProposal,
  setLoopContext,
} from './permissionBridge';

function setTestContext(loopId: string, conversationId: string): void {
  setLoopContext(loopId, {
    loopId,
    conversationId,
    commandConfirmCallback: async () => false,
    filePermissionCallback: async () => false,
    signal: new AbortController().signal,
    eventRouter: {} as never,
    toolCallToStepId: new Map(),
  });
}

describe('command confirmation routing', () => {
  beforeEach(() => {
    reviewQueueMocks.create.mockClear();
    reviewQueueMocks.decide.mockClear();
    reviewQueueMocks.get.mockReset();
    reviewQueueMocks.resolveMemory.mockClear();
    reviewQueueMocks.create.mockResolvedValue({ id: 'review-test' });
    reviewQueueMocks.decide.mockResolvedValue(true);
    reviewQueueMocks.get.mockReturnValue(undefined);
  });

  it('attributes a confirmation to the explicitly selected loop', async () => {
    setTestContext('loop-a', 'conversation-a');
    setTestContext('loop-b', 'conversation-b');

    const decision = requestCommandConfirmation({
      command: 'crm__send_message',
      level: 'danger',
      reason: 'requires approval',
      kind: 'external-action',
    }, 'loop-b');

    await vi.waitFor(() => {
      expect(getPendingCommandConfirmation()?.conversationId).toBe('conversation-b');
    });
    await resolveCommandConfirmation(false);
    await expect(decision).resolves.toBe(false);
    expect(reviewQueueMocks.create).toHaveBeenCalledOnce();
    expect(reviewQueueMocks.decide).toHaveBeenCalledWith('review-test', false, 'user');

    clearLoopContext('loop-a');
    clearLoopContext('loop-b');
  });

  it('fails closed when an approval decision cannot be persisted', async () => {
    setTestContext('loop-a', 'conversation-a');
    reviewQueueMocks.decide.mockResolvedValueOnce(false);

    const decision = requestCommandConfirmation({
      command: 'crm__send_message',
      level: 'danger',
      reason: 'requires approval',
      kind: 'external-action',
      externalActionKind: 'send',
    }, 'loop-a');

    await vi.waitFor(() => expect(getPendingCommandConfirmation()).not.toBeNull());
    await expect(resolveCommandConfirmation(true)).resolves.toBe(false);
    await expect(decision).resolves.toBe(false);

    clearLoopContext('loop-a');
  });

  it('can decide a queued review item without disturbing the active one', async () => {
    setTestContext('loop-a', 'conversation-a');
    reviewQueueMocks.create
      .mockResolvedValueOnce({ id: 'review-active' })
      .mockResolvedValueOnce({ id: 'review-queued' });

    const activeDecision = requestCommandConfirmation({
      command: 'social__publish_post',
      level: 'danger',
      reason: 'requires approval',
      kind: 'external-action',
      externalActionKind: 'publish',
    }, 'loop-a');
    const queuedDecision = requestCommandConfirmation({
      command: 'crm__send_message',
      level: 'danger',
      reason: 'requires approval',
      kind: 'external-action',
      externalActionKind: 'send',
    }, 'loop-a');

    await vi.waitFor(() => {
      expect(getPendingCommandConfirmation()?.reviewProposalId).toBe('review-active');
    });
    await expect(resolveReviewProposal('review-queued', true)).resolves.toBe(true);
    await expect(queuedDecision).resolves.toBe(true);
    expect(getPendingCommandConfirmation()?.reviewProposalId).toBe('review-active');

    await resolveCommandConfirmation(false);
    await expect(activeDecision).resolves.toBe(false);
    clearLoopContext('loop-a');
  });
});
