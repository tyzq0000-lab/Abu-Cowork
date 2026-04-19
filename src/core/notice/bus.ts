/**
 * Notice Bus — the pub/sub core of the Notice System.
 *
 * Producers call `publish` to raise an event. The Bus handles dedup,
 * builds the Notice object, and hands it to the pipeline (Gate → Router
 * → targeted channel dispatch).
 *
 * Legacy subscribers (registered via `subscribe`) still receive blanket
 * fan-out for backward compatibility during the migration window.
 * New code should use `registerChannel` from pipeline.ts to receive
 * only notices routed to a specific channel.
 *
 * Dispatch is synchronous within the event loop; handlers MUST handle
 * their own async work and error boundaries. Errors thrown by one
 * handler do not block other handlers.
 */

import {
  type Notice,
  type PublishInput,
  DEFAULT_TIER,
  DEFAULT_TTL_MS,
  generateNoticeId,
  NoticeSchema,
} from './types';
import { checkDedup, recordDedup } from './dedup';
import { processNotice, type PipelineResult } from './pipeline';

// ── Delivery channels ───────────────────────────────────────────────────

/**
 * Channel names that the Router will dispatch to. The Bus itself doesn't
 * know about channel semantics — it just keeps a handler set per
 * channel and fans out. Keep in sync with PRD-01 "触达通道" table.
 */
export type DeliveryChannel =
  | 'chat_card'
  | 'sidebar_badge'
  | 'menubar'
  | 'main_window_toast'
  | 'system_notification'
  | 'pet_bubble';

export type NoticeHandler = (notice: Notice) => void | Promise<void>;
export type Unsubscribe = () => void;

// ── State ───────────────────────────────────────────────────────────────

const subscribers = new Map<DeliveryChannel, Set<NoticeHandler>>();

// ── API ─────────────────────────────────────────────────────────────────

/**
 * Publish a notice. Returns the assigned id, or null if deduplicated.
 *
 * Dedup rule: same `dedupKey` within DEDUP_WINDOW_MS returns null.
 * The full Notice shape is validated via zod; invalid input throws
 * synchronously — producers must catch or fix the call site.
 */
export function publish(input: PublishInput): string | null {
  const now = Date.now();

  const existing = checkDedup(input.dedupKey, now);
  if (existing) return null;

  const notice: Notice = {
    id: generateNoticeId(),
    type: input.type,
    tier: input.tier ?? DEFAULT_TIER[input.type],
    source: input.source,
    payload: input.payload,
    dedupKey: input.dedupKey,
    createdAt: now,
    ttl: input.ttl ?? DEFAULT_TTL_MS[input.type],
  };

  NoticeSchema.parse(notice);

  recordDedup(input.dedupKey, notice.id, now);

  // Run full pipeline (Gate → Router → targeted channel dispatch)
  const result = processNotice(notice);
  lastPipelineResult = result;

  // Legacy blanket fan-out for backward compat during migration
  dispatch(notice);

  return notice.id;
}

/** Last pipeline result — exposed for testing and future audit integration. */
let lastPipelineResult: PipelineResult | null = null;

export function getLastPipelineResultForTest(): PipelineResult | null {
  return lastPipelineResult;
}

/** Subscribe a handler to a delivery channel. Returns an unsubscribe fn. */
export function subscribe(
  channel: DeliveryChannel,
  handler: NoticeHandler,
): Unsubscribe {
  let set = subscribers.get(channel);
  if (!set) {
    set = new Set();
    subscribers.set(channel, set);
  }
  set.add(handler);
  return () => {
    const current = subscribers.get(channel);
    if (current) current.delete(handler);
  };
}

// ── Internal ────────────────────────────────────────────────────────────

/**
 * Fan out to every subscriber of every channel. Handlers filter
 * themselves at this milestone; the Router will replace this blanket
 * fan-out with targeted dispatch once PRD-01 Router lands.
 */
function dispatch(notice: Notice): void {
  for (const handlers of subscribers.values()) {
    for (const handler of handlers) {
      try {
        const result = handler(notice);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            console.error('[notice] async handler rejected:', err);
          });
        }
      } catch (err) {
        console.error('[notice] handler threw:', err);
      }
    }
  }
}

// ── Test utilities ──────────────────────────────────────────────────────

export function clearSubscribersForTest(): void {
  subscribers.clear();
}

export function subscriberCountForTest(): number {
  let total = 0;
  for (const set of subscribers.values()) total += set.size;
  return total;
}
