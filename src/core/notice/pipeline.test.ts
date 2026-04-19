import { describe, it, expect, beforeEach } from 'vitest';
import {
  processNotice,
  registerChannel,
  setContextProvider,
  resetContextProviderForTest,
  clearChannelHandlersForTest,
} from './pipeline';
import { clearQuotaForTest, consumeL2Quota, L2_QUOTA } from './quota';
import type { Notice } from './types';
import type { GateContext } from './gate';

function makeNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: 'ntc_test',
    type: 'task_complete',
    tier: 'L1',
    source: 'agent',
    payload: {},
    dedupKey: 'k',
    createdAt: 1_000_000,
    ...overrides,
  };
}

function ctxWith(overrides: Partial<GateContext> = {}) {
  return (now: number): GateContext => ({
    now,
    mainWindowFocused: false,
    currentConversationId: null,
    petState: 'off',
    fullscreenApp: null,
    recentL2Count: { windowStart: 0, count: 0 },
    userFeedbackHistory: [],
    ...overrides,
  });
}

describe('Notice Pipeline (Gate → Router → Channels)', () => {
  beforeEach(() => {
    clearChannelHandlersForTest();
    clearQuotaForTest();
    resetContextProviderForTest();
  });

  describe('full pipeline flow', () => {
    it('L1 + unfocused + pet off → system_notification + menubar', () => {
      setContextProvider(ctxWith({ mainWindowFocused: false, petState: 'off' }));

      const delivered: string[] = [];
      registerChannel('system_notification', () => {
        delivered.push('system_notification');
      });
      registerChannel('menubar', () => {
        delivered.push('menubar');
      });

      const result = processNotice(makeNotice({ tier: 'L1' }));
      expect(result.decision.action).toBe('allow');
      expect(result.targets.map((t) => t.channel)).toEqual([
        'system_notification',
        'menubar',
      ]);
      expect(delivered).toEqual(['system_notification', 'menubar']);
    });

    it('L1 + focused + same convo → chat_card only', () => {
      setContextProvider(
        ctxWith({
          mainWindowFocused: true,
          currentConversationId: 'c1',
        }),
      );

      const delivered: string[] = [];
      registerChannel('chat_card', (_n, t) => {
        delivered.push(`chat_card:${t.conversationId}`);
      });

      const result = processNotice(
        makeNotice({
          tier: 'L1',
          payload: { conversationId: 'c1' },
        }),
      );
      expect(result.decision.action).toBe('allow');
      expect(delivered).toEqual(['chat_card:c1']);
    });

    it('L2 + focused + different convo → sidebar_badge', () => {
      setContextProvider(
        ctxWith({
          mainWindowFocused: true,
          currentConversationId: 'c1',
        }),
      );

      const delivered: string[] = [];
      registerChannel('sidebar_badge', (_n, t) => {
        delivered.push(`sidebar_badge:${t.conversationId}`);
      });

      const result = processNotice(
        makeNotice({
          tier: 'L2',
          type: 'skill_proposal_offer',
          payload: { conversationId: 'c2' },
        }),
      );
      expect(result.decision.action).toBe('allow');
      expect(delivered).toEqual(['sidebar_badge:c2']);
    });
  });

  describe('Gate blocking', () => {
    it('fullscreen blocks L2 → queue_inbox, no channel dispatch', () => {
      setContextProvider(ctxWith({ fullscreenApp: 'Keynote' }));

      const delivered: string[] = [];
      registerChannel('menubar', () => delivered.push('menubar'));

      const result = processNotice(
        makeNotice({ tier: 'L2', type: 'skill_proposal_offer' }),
      );
      expect(result.decision.action).toBe('queue_inbox');
      expect(result.targets).toEqual([]);
      expect(delivered).toEqual([]);
    });

    it('fullscreen blocks L3 → drop, no channel dispatch', () => {
      setContextProvider(ctxWith({ fullscreenApp: 'Keynote' }));

      const result = processNotice(
        makeNotice({ tier: 'L3', type: 'context_resume' }),
      );
      expect(result.decision.action).toBe('drop');
      expect(result.targets).toEqual([]);
    });

    it('L2 quota exhausted → queue_inbox', () => {
      setContextProvider(ctxWith({}));
      const now = 1_000_000;
      for (let i = 0; i < L2_QUOTA; i++) consumeL2Quota(now + i);

      const result = processNotice(
        makeNotice({
          tier: 'L2',
          type: 'skill_proposal_offer',
          createdAt: now + L2_QUOTA,
        }),
      );
      expect(result.decision.action).toBe('queue_inbox');
      expect(result.targets).toEqual([]);
    });
  });

  describe('tier degradation', () => {
    it('degrade rule changes routing tier', () => {
      setContextProvider(
        ctxWith({
          mainWindowFocused: false,
          petState: 'off',
          userFeedbackHistory: [
            {
              label: 'evening-degrade',
              matches: () => true,
              action: 'degrade',
              degradeTo: 'L3',
            },
          ],
        }),
      );

      const delivered: string[] = [];
      registerChannel('menubar', () => delivered.push('menubar'));
      registerChannel('system_notification', () =>
        delivered.push('system_notification'),
      );

      const result = processNotice(
        makeNotice({ tier: 'L2', type: 'skill_proposal_offer' }),
      );
      expect(result.decision.action).toBe('degrade_tier');
      // L3 routes to menubar only
      expect(result.targets.map((t) => t.channel)).toEqual(['menubar']);
      expect(delivered).toEqual(['menubar']);
    });
  });

  describe('handler error isolation', () => {
    it('throwing handler does not block sibling channel handlers', () => {
      setContextProvider(ctxWith({ mainWindowFocused: false, petState: 'off' }));

      const delivered: string[] = [];
      registerChannel('system_notification', () => {
        throw new Error('boom');
      });
      registerChannel('menubar', () => delivered.push('menubar'));

      const result = processNotice(makeNotice({ tier: 'L1' }));
      expect(result.targets.length).toBe(2);
      expect(delivered).toEqual(['menubar']);
    });
  });

  describe('L2 quota consumption', () => {
    it('allowed L2 consumes quota slot', () => {
      setContextProvider(
        ctxWith({
          mainWindowFocused: true,
          currentConversationId: 'c1',
        }),
      );

      for (let i = 0; i < L2_QUOTA; i++) {
        const result = processNotice(
          makeNotice({
            id: `ntc_${i}`,
            tier: 'L2',
            type: 'skill_proposal_offer',
            payload: { conversationId: 'c1' },
            createdAt: 1_000_000 + i,
          }),
        );
        expect(result.decision.action).toBe('allow');
      }

      // Next L2 should hit quota
      const result = processNotice(
        makeNotice({
          id: 'ntc_overflow',
          tier: 'L2',
          type: 'skill_proposal_offer',
          payload: { conversationId: 'c1' },
          createdAt: 1_000_000 + L2_QUOTA,
        }),
      );
      expect(result.decision.action).toBe('queue_inbox');
    });
  });
});
