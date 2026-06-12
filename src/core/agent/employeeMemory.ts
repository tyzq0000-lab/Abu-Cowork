import type { SubagentDefinition } from '@/types';

export function resolveAgentMemoryPaths(
  agent: SubagentDefinition,
  workspacePath: string | null,
): Array<string | null> {
  switch (agent.memory ?? 'session') {
    case 'project':
      return workspacePath ? [workspacePath] : [];
    case 'user':
      return [null];
    case 'session':
      return [];
  }
}
