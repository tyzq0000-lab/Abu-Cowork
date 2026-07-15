import type { SubagentDefinition } from '@/types';
import { skillLoader } from '../skill/loader';

export function getEmployeeToolShadows(agent: SubagentDefinition): string[] {
  if (agent.source !== 'employee' || !agent.skills?.length) return [];
  const names = agent.skills.flatMap((name) => skillLoader.getSkill(name, agent.name)?.shadows ?? []);
  return [...new Set(names)];
}

export function buildEmployeeSkillsSection(
  agent: SubagentDefinition,
  workspacePath: string | null = null,
): string {
  if (agent.source !== 'employee' || !agent.skills?.length) return '';

  const skills = agent.skills
    .map((name) => skillLoader.getSkill(name, agent.name))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));

  if (skills.length === 0) return '';

  const parts: string[] = [
    '## 岗位技能',
    '以下技能由数字员工包声明。执行匹配任务前必须先调用 use_skill 激活对应技能，再严格遵循加载后的工作流。',
    '当任务匹配某项岗位技能时（如生图、视频、内容选题、数据复盘、发布审批等），优先激活并使用该岗位技能，'
      + '不得用扶摇内置的同类通用能力（如内置生图、通用搜索）替代——岗位技能定义了完整工作流、产出标准与降级路径。',
    '不得在用户工作区搜索员工包脚本；脚本路径由激活后的技能说明和运行时变量提供。',
    ...skills.map((skill) => `- /${skill.name} — ${skill.description}`),
  ];

  if (!workspacePath) {
    parts.push(
      '【工作区未绑定】当前对话未选择工作区。'
      + '需要写入 ${ABU_WORKSPACE} 的技能脚本将无法正常运行。'
      + '请主动告知用户：需先在侧栏选择或创建工作区，再执行上述岗位技能。',
    );
  }

  return parts.join('\n\n');
}
