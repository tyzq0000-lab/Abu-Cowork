import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri fetch before importing
vi.mock('./tauriFetch', () => ({
  getTauriFetch: vi.fn().mockResolvedValue(globalThis.fetch),
}));

// Mock Anthropic SDK — we control the stream behavior
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
    APIError: class MockAPIError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
  };
});

import { ClaudeAdapter } from './claude';

describe('ClaudeAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stream idle timeout', () => {
    it('emits error + done after 90s of no data', async () => {
      // Create a controllable async iterator that hangs after creation
      // The stream yields nothing — simulating a network hang after connection
      let resolveHang: (() => void) | null = null;
      const hangPromise = new Promise<void>(r => { resolveHang = r; });

      const hangingStream = {
        [Symbol.asyncIterator]: () => ({
          next: () => hangPromise.then(() => ({ done: true as const, value: undefined })),
        }),
      };
      mockCreate.mockResolvedValue(hangingStream);

      const events: Array<{ type: string; error?: string; stopReason?: string }> = [];
      const adapter = new ClaudeAdapter();

      // Start chat — will enter the for-await loop and block on the hanging iterator
      const chatPromise = adapter.chat(
        [{ role: 'user', content: 'hello', id: '1', timestamp: Date.now() }],
        { apiKey: 'test-key', model: 'claude-sonnet-4-6', maxTokens: 1024 },
        (event) => events.push(event),
      );

      // Let microtasks settle (mockCreate resolves, enters for-await)
      await vi.advanceTimersByTimeAsync(0);

      // No events yet (stream is hanging)
      expect(events).toHaveLength(0);

      // Advance 89s — should NOT have timed out yet
      await vi.advanceTimersByTimeAsync(89_000);
      expect(events).toHaveLength(0);

      // Advance past 90s — timeout should fire
      await vi.advanceTimersByTimeAsync(2_000);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Stream idle timeout: no data received for 90s',
      });
      expect(events[1]).toEqual({
        type: 'done',
        stopReason: 'end_turn',
      });

      // Unblock the stream so the chat promise can settle
      resolveHang!();
      await chatPromise.catch(() => {});
    });
  });
});
