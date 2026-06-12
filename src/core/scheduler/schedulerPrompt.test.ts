import { describe, expect, it } from 'vitest';
import { buildScheduledTaskPrompt } from './scheduler';
import type { ScheduledTask } from '@/types/schedule';

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Weekly review',
    prompt: 'Review the latest work',
    schedule: { frequency: 'manual' },
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    runs: [],
    totalRuns: 0,
    ...overrides,
  };
}

describe('buildScheduledTaskPrompt', () => {
  it('routes an employee template through the declared employee and skill', () => {
    expect(buildScheduledTaskPrompt(makeTask({
      agentName: 'new-media-ops',
      skillName: 'weekly-review',
    }))).toBe('@new-media-ops /weekly-review Review the latest work');
  });
});
