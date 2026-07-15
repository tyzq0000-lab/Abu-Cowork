import type { SubagentDefinition } from '@/types';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import { normalizeSeparators } from '@/utils/pathUtils';

const EMPLOYEE_MEMORY_PREFIX = 'uprow-employee-memory://';

export class EmployeeMemoryIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeMemoryIsolationError';
  }
}

function employeeOwnerKey(agent: SubagentDefinition, conversationId?: string): string {
  if (conversationId) {
    const matches = Object.values(useEmployeeDeploymentStore.getState().deployments).filter(
      (deployment) => deployment.conversationId === conversationId
        && deployment.agentName === agent.name
        && !!deployment.deploymentId,
    );
    if (matches.length > 1) {
      throw new EmployeeMemoryIsolationError(
        '当前对话绑定了多个员工部署，已停止长期记忆读写以防企业数据串用。请重新部署该员工。',
      );
    }
    if (matches[0]?.deploymentId) return `deployment/${matches[0].deploymentId}`;
  }
  return `local/${agent.name}`;
}

/** Resolve one employee-private memdir key. The key is never an actual workspace path. */
export function resolveEmployeeMemoryPath(
  agent: SubagentDefinition,
  workspacePath: string | null,
  conversationId?: string,
): string | null {
  if (agent.source !== 'employee' || (agent.memory ?? 'session') === 'session') return null;

  const owner = employeeOwnerKey(agent, conversationId);
  if (agent.memory === 'project') {
    if (!workspacePath) return null;
    return `${EMPLOYEE_MEMORY_PREFIX}${owner}/project/${normalizeSeparators(workspacePath)}`;
  }
  return `${EMPLOYEE_MEMORY_PREFIX}${owner}/user`;
}

export function resolveAgentMemoryPaths(
  agent: SubagentDefinition,
  workspacePath: string | null,
  conversationId?: string,
): Array<string | null> {
  if (agent.source === 'employee') {
    const path = resolveEmployeeMemoryPath(agent, workspacePath, conversationId);
    return path ? [path] : [];
  }
  switch (agent.memory ?? 'session') {
    case 'project':
      return workspacePath ? [workspacePath] : [];
    case 'user':
      return [null];
    case 'session':
      return [];
  }
}
