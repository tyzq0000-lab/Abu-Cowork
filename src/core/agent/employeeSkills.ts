import type { SubagentDefinition } from '@/types';
import { skillLoader } from '../skill/loader';

export function buildEmployeeSkillsSection(agent: SubagentDefinition): string {
  if (agent.source !== 'employee' || !agent.skills?.length) return '';

  const skills = agent.skills
    .map((name) => skillLoader.getSkill(name))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));

  if (skills.length === 0) return '';

  return [
    '## 岗位技能',
    '以下技能由数字员工包声明。根据任务选择并严格遵循对应工作流。',
    ...skills.map((skill) => `### ${skill.name}\n${skill.content}`),
  ].join('\n\n');
}
