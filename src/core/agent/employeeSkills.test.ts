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
  it('injects every available skill declared by the employee package', () => {
    const agent = {
      name: 'new-media-ops',
      description: 'New media operator',
      systemPrompt: 'Operate content channels.',
      skills: ['content-review', 'missing-skill'],
      source: 'employee',
    } as SubagentDefinition;

    expect(buildEmployeeSkillsSection(agent)).toContain(
      '### content-review\nFollow the content review workflow.',
    );
    expect(buildEmployeeSkillsSection(agent)).not.toContain('missing-skill');
  });
});
