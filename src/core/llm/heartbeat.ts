/**
 * Heartbeat — shared idle timeout for LLM streaming connections.
 *
 * Detects when a streaming connection stops sending data (network hang,
 * server stall) without closing the connection. Both Claude and OpenAI
 * adapters use this to trigger a timeout error after 90s of silence.
 *
 * Usage:
 *   const hb = createHeartbeat(90_000, () => emit('error', ...));
 *   hb.reset();           // Start / reset timer
 *   for await (chunk) {
 *     hb.reset();         // Reset on each data chunk
 *   }
 *   hb.clear();           // Clean up on stream end
 */

/**
 * Default idle/connect timeout (ms) for LLM streaming connections. Shared by both
 * LLM adapters for the connect/header phase and the inter-chunk idle timeout.
 *
 * 取值权衡：太短会把「慢推理模型迟迟不出第一个 token」误判成网络挂起（功能被打断）；
 * 太长则连到一个已死的 socket 时用户要干等整段时间才会看到可重试错误。
 * 原为 90s（CC 验证值），2026-07-26 提到 180s——放宽是为迁就更慢的推理模型。
 * 边界测试从本常量派生（claude.test.ts / openai-compatible.test.ts），改值不会误红。
 */
export const DEFAULT_STREAM_HANG_TIMEOUT_MS = 180_000;

/**
 * Create a heartbeat timer that calls `onTimeout` if not reset within `timeoutMs`.
 */
export function createHeartbeat(
  timeoutMs: number,
  onTimeout: () => void,
): { reset: () => void; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function reset(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onTimeout, timeoutMs);
  }

  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { reset, clear };
}

/**
 * Merge AbortSignals into one that aborts when ANY input aborts.
 *
 * Prefers the native `AbortSignal.any` (clean, no listener leak), but falls
 * back to manual forwarding on engines that lack it — notably WKWebView on
 * macOS < 14.4 (Safari < 17.4), where `AbortSignal.any` is `undefined`. Without
 * the fallback, calling it would throw `TypeError` on the first line of every
 * chat() and break ALL conversations on those systems. Only `addEventListener`
 * (a 20-year-old API) is used in the fallback, so it runs everywhere.
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
