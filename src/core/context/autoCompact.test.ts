import { describe, it, expect } from 'vitest';
import { calculateWarningLevel, getUsagePercent, AutoCompactTracker } from './autoCompact';

describe('autoCompact', () => {
  describe('calculateWarningLevel', () => {
    it('returns 0 for low usage', () => {
      expect(calculateWarningLevel(50000, 100000)).toBe(0);
    });

    it('returns 1 for 60-75% usage', () => {
      expect(calculateWarningLevel(65000, 100000)).toBe(1);
    });

    it('returns 2 for 75-85% usage', () => {
      expect(calculateWarningLevel(80000, 100000)).toBe(2);
    });

    it('returns 3 for >85% usage', () => {
      expect(calculateWarningLevel(90000, 100000)).toBe(3);
    });

    it('returns 0 for zero max tokens', () => {
      expect(calculateWarningLevel(1000, 0)).toBe(0);
    });

    it('returns level at exact boundaries', () => {
      // At 60% exactly
      expect(calculateWarningLevel(60000, 100000)).toBe(1);
      // At 75% exactly
      expect(calculateWarningLevel(75000, 100000)).toBe(2);
      // At 85% exactly
      expect(calculateWarningLevel(85000, 100000)).toBe(3);
    });
  });

  describe('getUsagePercent', () => {
    it('returns correct percentage', () => {
      expect(getUsagePercent(75000, 100000)).toBe(75);
    });

    it('returns 0 for zero max', () => {
      expect(getUsagePercent(1000, 0)).toBe(0);
    });
  });

  describe('AutoCompactTracker', () => {
    it('should compact at level 2+', () => {
      const tracker = new AutoCompactTracker();
      expect(tracker.shouldCompact(0)).toBe(false);
      expect(tracker.shouldCompact(1)).toBe(false);
      expect(tracker.shouldCompact(2)).toBe(true);
      expect(tracker.shouldCompact(3)).toBe(true);
    });

    it('should force hard truncation at level 3', () => {
      const tracker = new AutoCompactTracker();
      expect(tracker.shouldForceHardTruncation(2)).toBe(false);
      expect(tracker.shouldForceHardTruncation(3)).toBe(true);
    });

    it('resets failure count on success', () => {
      const tracker = new AutoCompactTracker();
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.recordSuccess();
      // After success, 2 more failures shouldn't trip breaker (need 3 consecutive)
      tracker.recordFailure();
      tracker.recordFailure();
      expect(tracker.isDisabled()).toBe(false);
    });

    it('trips circuit breaker after 3 consecutive failures', () => {
      const tracker = new AutoCompactTracker();
      tracker.recordFailure();
      tracker.recordFailure();
      expect(tracker.isDisabled()).toBe(false);
      tracker.recordFailure();
      expect(tracker.isDisabled()).toBe(true);
      // Should not compact when disabled
      expect(tracker.shouldCompact(3)).toBe(false);
    });

    it('tracks warning level', () => {
      const tracker = new AutoCompactTracker();
      expect(tracker.getLastLevel()).toBe(0);
      const level = tracker.updateLevel(80000, 100000);
      expect(level).toBe(2);
      expect(tracker.getLastLevel()).toBe(2);
    });
  });
});
