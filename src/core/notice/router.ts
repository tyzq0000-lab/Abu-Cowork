/**
 * Notice Router — decides which delivery channels receive a notice.
 *
 * Pipeline: Bus → Gate → **Router** → Channels.
 *
 * Router is a pure function: given a Notice + runtime context, it
 * returns a list of DeliveryTarget descriptors. The caller (Bus
 * integration layer, not yet wired) iterates the targets and dispatches
 * to each channel's handler.
 *
 * Dispatch matrix (from PRD-01 techspec):
 *
 * 1. Main window focused + same conversation → chat_card (done, return)
 * 2. Main window focused + different conversation → sidebar_badge (done, return)
 * 3. Window unfocused + pet v2 + L1/L2 → pet_bubble (+ system_notification for L1)
 * 4. Window unfocused + pet off/v1 + L1 → system_notification
 * 5. Window unfocused + pet off/v1 + L2 → empty (Gate should have queued to inbox)
 * 6. All non-L3 → menubar badge
 * 7. L3 → menubar only (status light)
 */

import type { Notice } from './types';
import type { GateContext } from './gate';

// ── DeliveryTarget ─────────────────────────────────────────────────────

export type DeliveryChannel =
  | 'chat_card'
  | 'sidebar_badge'
  | 'menubar'
  | 'main_window_toast'
  | 'system_notification'
  | 'pet_bubble';

export interface DeliveryTarget {
  channel: DeliveryChannel;
  /** For chat_card / sidebar_badge — which conversation to badge. */
  conversationId?: string;
}

// ── API ────────────────────────────────────────────────────────────────

/**
 * Decide which channels should receive this notice. Pure — no I/O.
 *
 * The router does NOT enforce tier rules (that's Gate's job). It trusts
 * that if a notice arrives here, Gate already allowed it.
 */
export function route(notice: Notice, ctx: GateContext): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];
  const convoId = notice.payload.conversationId as string | undefined;

  // L3 only lights the menubar status dot — no bubble, no badge, no notification
  if (notice.tier === 'L3') {
    targets.push({ channel: 'menubar' });
    return targets;
  }

  // ── Main window focused ──────────────────────────────────────────

  if (ctx.mainWindowFocused) {
    if (convoId && convoId === ctx.currentConversationId) {
      targets.push({ channel: 'chat_card', conversationId: convoId });
      return targets;
    }
    if (convoId) {
      targets.push({ channel: 'sidebar_badge', conversationId: convoId });
      return targets;
    }
    // No conversationId but focused → toast in main window
    targets.push({ channel: 'main_window_toast' });
    targets.push({ channel: 'menubar' });
    return targets;
  }

  // ── Main window NOT focused ──────────────────────────────────────

  if (ctx.petState === 'v2_with_bubble') {
    targets.push({ channel: 'pet_bubble' });
    if (notice.tier === 'L1') {
      targets.push({ channel: 'system_notification' });
    }
  } else {
    // Pet off or v1_no_bubble → fallback channels
    if (notice.tier === 'L1') {
      targets.push({ channel: 'system_notification' });
    }
    // L2 with no pet bubble: Gate should have queue_inbox'd this.
    // If it reaches here anyway (e.g. quota not yet exhausted),
    // we still deliver to menubar below — no active interruption.
  }

  targets.push({ channel: 'menubar' });
  return targets;
}
