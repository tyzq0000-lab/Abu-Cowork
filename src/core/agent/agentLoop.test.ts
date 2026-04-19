import { describe, it, expect } from 'vitest';
import { escalateMaxOutputTokens, isInteractiveDesktop } from './agentLoop';

describe('escalateMaxOutputTokens', () => {
  it('does not escalate when recoveryCount is 0', () => {
    const result = escalateMaxOutputTokens(8192, 200000, 0, false);
    expect(result).toEqual({ maxOutputTokens: 8192, changed: false });
  });

  it('does not escalate when already escalated', () => {
    const result = escalateMaxOutputTokens(8192, 200000, 1, true);
    expect(result).toEqual({ maxOutputTokens: 8192, changed: false });
  });

  it('doubles maxOutputTokens on first recovery', () => {
    const result = escalateMaxOutputTokens(8192, 200000, 1, false);
    expect(result).toEqual({ maxOutputTokens: 16384, changed: true });
  });

  it('caps at contextWindowSize - 1000', () => {
    // contextWindow is 10000, so cap = 9000, doubling 8192 would be 16384 > 9000
    const result = escalateMaxOutputTokens(8192, 10000, 1, false);
    expect(result).toEqual({ maxOutputTokens: 9000, changed: true });
  });

  it('does not escalate when already at context limit', () => {
    // currentMax=9000, contextWindow=10000, cap=9000 — doubling gives 9000, not > 9000
    const result = escalateMaxOutputTokens(9000, 10000, 1, false);
    expect(result).toEqual({ maxOutputTokens: 9000, changed: false });
  });

  it('works with large context windows', () => {
    const result = escalateMaxOutputTokens(32768, 1000000, 2, false);
    expect(result).toEqual({ maxOutputTokens: 65536, changed: true });
  });
});

// Task #49 · Gate that protects memory extraction + post-loop proposal
// signal from firing in headless contexts. Regression-critical because
// the bug mode is silent: failing gates leak skill drafts and memories
// into user-invisible directories.
describe('isInteractiveDesktop', () => {
  it('desktop conversation (no imContext, no scheduledTaskId, no triggerId) → true', () => {
    expect(isInteractiveDesktop(undefined, {})).toBe(true);
    expect(isInteractiveDesktop({}, undefined)).toBe(true);
    expect(isInteractiveDesktop({}, {})).toBe(true);
  });

  it('IM headless conversation (imContext set) → false', () => {
    expect(
      isInteractiveDesktop(
        { imContext: { platform: 'dchat', workspacePath: '/ws' } },
        {},
      ),
    ).toBe(false);
  });

  it('scheduled-task conversation → false', () => {
    expect(isInteractiveDesktop({}, { scheduledTaskId: 'task-42' })).toBe(false);
  });

  it('trigger-run conversation → false', () => {
    expect(isInteractiveDesktop({}, { triggerId: 'trigger-7' })).toBe(false);
  });

  it('absent conversation record (shouldn’t happen, defensive) → falls through to options-only check', () => {
    // convRecord may be absent if the conversation was deleted mid-run.
    // The gate should not crash and should rely on options to decide.
    expect(isInteractiveDesktop(undefined, undefined)).toBe(true);
    expect(
      isInteractiveDesktop(
        { imContext: { platform: 'dchat', workspacePath: '/ws' } },
        undefined,
      ),
    ).toBe(false);
  });

  it('any single headless marker is enough to lock the gate', () => {
    // Pathological combo shouldn't accidentally re-open the gate — each
    // marker is an independent "headless" condition.
    expect(
      isInteractiveDesktop(
        { imContext: { channelId: 'c', platform: 'dchat', workspacePath: '/ws' } },
        { scheduledTaskId: 'x', triggerId: 'y' },
      ),
    ).toBe(false);
  });
});
