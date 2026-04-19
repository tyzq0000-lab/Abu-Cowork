/**
 * Notice Pipeline — orchestrates Bus → Gate → Router → Channel dispatch.
 *
 * This module replaces the blanket fan-out in bus.ts with the full
 * Gate/Router pipeline. Bus calls `processNotice` after dedup; the
 * pipeline runs Gate filter, then (if allowed) Router dispatch, then
 * delivers to targeted channel handlers only.
 *
 * Quota consumption: when Gate allows an L2 notice, pipeline calls
 * consumeL2Quota so the sliding window stays accurate.
 *
 * GateContext assembly: the pipeline reads runtime state (window focus,
 * pet state, fullscreen) from a pluggable context provider. Day 5
 * ships a default provider that returns safe defaults; Week 2 wires
 * the real providers (Tauri window focus, fullscreen Rust command, etc).
 */

import type { Notice } from './types';
import { filter, type GateContext, type GateDecision } from './gate';
import { route, type DeliveryTarget } from './router';
import { consumeL2Quota } from './quota';

// ── Context provider ───────────────────────────────────────────────────

export type GateContextProvider = (now: number) => GateContext;

const defaultContextProvider: GateContextProvider = (now) => ({
  now,
  mainWindowFocused: true,
  currentConversationId: null,
  petState: 'off',
  fullscreenApp: null,
  recentL2Count: { windowStart: 0, count: 0 },
  userFeedbackHistory: [],
});

let contextProvider: GateContextProvider = defaultContextProvider;

export function setContextProvider(provider: GateContextProvider): void {
  contextProvider = provider;
}

export function resetContextProviderForTest(): void {
  contextProvider = defaultContextProvider;
}

// ── Channel handler registry ───────────────────────────────────────────

export type ChannelHandler = (notice: Notice, target: DeliveryTarget) => void | Promise<void>;

type DeliveryChannelName = DeliveryTarget['channel'];

const channelHandlers = new Map<DeliveryChannelName, Set<ChannelHandler>>();

export function registerChannel(
  channel: DeliveryChannelName,
  handler: ChannelHandler,
): () => void {
  let set = channelHandlers.get(channel);
  if (!set) {
    set = new Set();
    channelHandlers.set(channel, set);
  }
  set.add(handler);
  return () => {
    const current = channelHandlers.get(channel);
    if (current) current.delete(handler);
  };
}

// ── Pipeline result (for audit / debugging) ────────────────────────────

export interface PipelineResult {
  decision: GateDecision;
  targets: DeliveryTarget[];
}

// ── Core pipeline ──────────────────────────────────────────────────────

/**
 * Run a notice through Gate → Router → Channel dispatch.
 * Returns the pipeline result for audit/logging (Week 2 notice_audit).
 */
export function processNotice(notice: Notice): PipelineResult {
  const now = notice.createdAt;
  const ctx = contextProvider(now);

  const decision = filter(notice, ctx);

  if (decision.action !== 'allow' && decision.action !== 'degrade_tier') {
    return { decision, targets: [] };
  }

  // Apply tier degradation before routing
  const routedNotice: Notice =
    decision.action === 'degrade_tier'
      ? { ...notice, tier: decision.to }
      : notice;

  // Consume L2 quota on allowed L2 notices
  if (routedNotice.tier === 'L2') {
    consumeL2Quota(now);
  }

  const targets = route(routedNotice, ctx);

  // Dispatch to targeted channel handlers
  for (const target of targets) {
    const handlers = channelHandlers.get(target.channel);
    if (!handlers) continue;
    for (const handler of handlers) {
      try {
        const result = handler(routedNotice, target);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            console.error(`[notice] channel:${target.channel} handler rejected:`, err);
          });
        }
      } catch (err) {
        console.error(`[notice] channel:${target.channel} handler threw:`, err);
      }
    }
  }

  return { decision, targets };
}

// ── Test utilities ─────────────────────────────────────────────────────

export function clearChannelHandlersForTest(): void {
  channelHandlers.clear();
}
