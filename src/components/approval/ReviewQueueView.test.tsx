import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const permissionMocks = vi.hoisted(() => ({
  resolve: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/core/agent/permissionBridge', () => ({
  resolveReviewProposal: permissionMocks.resolve,
}));

import {
  createReviewProposal,
  resetReviewQueueForTests,
} from '@/core/approval/reviewQueue';
import ReviewQueueView from './ReviewQueueView';

describe('ReviewQueueView', () => {
  afterEach(cleanup);

  beforeEach(() => {
    permissionMocks.resolve.mockClear();
    resetReviewQueueForTests();
  });

  it('shows a redacted proposal and routes approval through the live permission bridge', async () => {
    const proposal = await createReviewProposal({
      info: {
        command: 'social__publish_post',
        level: 'danger',
        reason: 'requires approval',
        kind: 'external-action',
        externalActionKind: 'publish',
        toolName: 'social__publish_post',
        reviewPayload: '{"title":"季度复盘","token":"do-not-show"}',
      },
      conversationId: 'conversation-1',
      agentName: '内容运营专员',
    });

    render(<ReviewQueueView />);

    expect(screen.getByText('内容运营专员', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/季度复盘/)).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
    expect(screen.queryByText(/do-not-show/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^(Approve|批准执行)$/ }));

    expect(permissionMocks.resolve).toHaveBeenCalledWith(proposal.id, true);
  });
});
