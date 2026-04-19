import { describe, it, expect } from 'vitest';
import { route, type DeliveryTarget } from './router';
import type { GateContext } from './gate';
import type { Notice } from './types';

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

function makeCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: 1_000_000,
    mainWindowFocused: false,
    currentConversationId: null,
    petState: 'off',
    fullscreenApp: null,
    recentL2Count: { windowStart: 0, count: 0 },
    userFeedbackHistory: [],
    ...overrides,
  };
}

function channels(targets: DeliveryTarget[]): string[] {
  return targets.map((t) => t.channel);
}

describe('Notice Router · route', () => {
  describe('main window focused', () => {
    it('same conversation → chat_card only', () => {
      const targets = route(
        makeNotice({ payload: { conversationId: 'c1' } }),
        makeCtx({ mainWindowFocused: true, currentConversationId: 'c1' }),
      );
      expect(targets).toEqual([
        { channel: 'chat_card', conversationId: 'c1' },
      ]);
    });

    it('different conversation → sidebar_badge only', () => {
      const targets = route(
        makeNotice({ payload: { conversationId: 'c2' } }),
        makeCtx({ mainWindowFocused: true, currentConversationId: 'c1' }),
      );
      expect(targets).toEqual([
        { channel: 'sidebar_badge', conversationId: 'c2' },
      ]);
    });

    it('no conversationId → main_window_toast + menubar', () => {
      const targets = route(
        makeNotice({ payload: {} }),
        makeCtx({ mainWindowFocused: true }),
      );
      expect(channels(targets)).toEqual(['main_window_toast', 'menubar']);
    });
  });

  describe('main window NOT focused', () => {
    it('pet v2 + L1 → pet_bubble + system_notification + menubar', () => {
      const targets = route(
        makeNotice({ tier: 'L1' }),
        makeCtx({ petState: 'v2_with_bubble' }),
      );
      expect(channels(targets)).toEqual([
        'pet_bubble',
        'system_notification',
        'menubar',
      ]);
    });

    it('pet v2 + L2 → pet_bubble + menubar (no system_notification)', () => {
      const targets = route(
        makeNotice({ tier: 'L2' }),
        makeCtx({ petState: 'v2_with_bubble' }),
      );
      expect(channels(targets)).toEqual(['pet_bubble', 'menubar']);
    });

    it('pet off + L1 → system_notification + menubar', () => {
      const targets = route(
        makeNotice({ tier: 'L1' }),
        makeCtx({ petState: 'off' }),
      );
      expect(channels(targets)).toEqual([
        'system_notification',
        'menubar',
      ]);
    });

    it('pet v1_no_bubble + L1 → system_notification + menubar', () => {
      const targets = route(
        makeNotice({ tier: 'L1' }),
        makeCtx({ petState: 'v1_no_bubble' }),
      );
      expect(channels(targets)).toEqual([
        'system_notification',
        'menubar',
      ]);
    });

    it('pet off + L2 → menubar only (no active interruption)', () => {
      const targets = route(
        makeNotice({ tier: 'L2' }),
        makeCtx({ petState: 'off' }),
      );
      expect(channels(targets)).toEqual(['menubar']);
    });
  });

  describe('L3 handling', () => {
    it('L3 always → menubar only, regardless of window/pet state', () => {
      const cases: Partial<GateContext>[] = [
        { mainWindowFocused: true, currentConversationId: 'c1' },
        { mainWindowFocused: false, petState: 'v2_with_bubble' },
        { mainWindowFocused: false, petState: 'off' },
      ];
      for (const ctxOverrides of cases) {
        const targets = route(
          makeNotice({
            tier: 'L3',
            payload: { conversationId: 'c1' },
          }),
          makeCtx(ctxOverrides),
        );
        expect(channels(targets)).toEqual(['menubar']);
      }
    });
  });

  describe('edge cases', () => {
    it('focused + no currentConversationId + has convoId → sidebar_badge', () => {
      const targets = route(
        makeNotice({ payload: { conversationId: 'c1' } }),
        makeCtx({ mainWindowFocused: true, currentConversationId: null }),
      );
      expect(targets).toEqual([
        { channel: 'sidebar_badge', conversationId: 'c1' },
      ]);
    });

    it('pet v2 + L3 → menubar only (L3 early return before pet check)', () => {
      const targets = route(
        makeNotice({ tier: 'L3' }),
        makeCtx({ petState: 'v2_with_bubble' }),
      );
      expect(channels(targets)).toEqual(['menubar']);
    });
  });
});
