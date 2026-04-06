import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHeartbeat } from './heartbeat';

describe('heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onTimeout after specified delay', () => {
    const onTimeout = vi.fn();
    const hb = createHeartbeat(5000, onTimeout);
    hb.reset();

    vi.advanceTimersByTime(4999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('resets timer on each reset() call', () => {
    const onTimeout = vi.fn();
    const hb = createHeartbeat(5000, onTimeout);
    hb.reset();

    vi.advanceTimersByTime(3000);
    hb.reset(); // Reset at 3s — should now wait another 5s

    vi.advanceTimersByTime(4999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('does not call onTimeout after clear()', () => {
    const onTimeout = vi.fn();
    const hb = createHeartbeat(5000, onTimeout);
    hb.reset();

    vi.advanceTimersByTime(3000);
    hb.clear();

    vi.advanceTimersByTime(10000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('can be reset multiple times', () => {
    const onTimeout = vi.fn();
    const hb = createHeartbeat(1000, onTimeout);

    for (let i = 0; i < 10; i++) {
      hb.reset();
      vi.advanceTimersByTime(500);
    }
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('clear() is safe to call multiple times', () => {
    const onTimeout = vi.fn();
    const hb = createHeartbeat(1000, onTimeout);
    hb.reset();
    hb.clear();
    hb.clear(); // Should not throw
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clear() before reset() is safe', () => {
    const onTimeout = vi.fn();
    const hb = createHeartbeat(1000, onTimeout);
    hb.clear(); // No timer started yet — should not throw
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
