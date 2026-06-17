import { describe, expect, it, vi } from 'vitest';
import type { SubagentDefinition } from '@/types';
import { buildEmployeeSkillsSection } from './employeeSkills';

vi.mock('../skill/loader', () => ({
  skillLoader: {
    getSkill: vi.fn((name: string) => name === 'content-review'
      ? {
          name,
          description: 'Review content',
          content: 'Follow the content review workflow.',
        }
      : undefined),
  },
}));

describe('buildEmployeeSkillsSection', () => {
  it('lists declared employee skills without inlining their workflow bodies', () => {
    const agent = {
      name: 'new-media-ops',
      description: 'New media operator',
      systemPrompt: 'Operate content channels.',
      skills: ['content-review', 'missing-skill'],
      source: 'employee',
    } as SubagentDefinition;

    const section = buildEmployeeSkillsSection(agent);

    expect(section).toContain('/content-review — Review content');
    expect(section).toContain('use_skill');
    expect(section).not.toContain('Follow the content review workflow.');
    expect(section).not.toContain('missing-skill');
  });
});
