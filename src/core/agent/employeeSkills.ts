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
    '以下技能由数字员工包声明。执行匹配任务前必须先调用 use_skill 激活对应技能，再严格遵循加载后的工作流。',
    '不得在用户工作区搜索员工包脚本；脚本路径由激活后的技能说明和运行时变量提供。',
    ...skills.map((skill) => `- /${skill.name} — ${skill.description}`),
  ].join('\n\n');
}
