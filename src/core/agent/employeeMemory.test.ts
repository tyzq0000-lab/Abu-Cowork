import { beforeEach, describe, expect, it } from 'vitest';
import type { SubagentDefinition } from '@/types';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import {
  EmployeeMemoryIsolationError,
  resolveAgentMemoryPaths,
  resolveEmployeeMemoryPath,
} from './employeeMemory';

function agent(memory: SubagentDefinition['memory']): SubagentDefinition {
  return {
    name: 'employee',
    description: 'Employee',
    systemPrompt: 'Work.',
    filePath: 'employee.md',
    memory,
  };
}

function employee(name: string, memory: SubagentDefinition['memory']): SubagentDefinition {
  return { ...agent(memory), name, source: 'employee' };
}

describe('resolveAgentMemoryPaths', () => {
  beforeEach(() => useEmployeeDeploymentStore.setState({ deployments: {}, integrity: {} }));

  it('keeps session memory ephemeral', () => {
    expect(resolveAgentMemoryPaths(agent('session'), 'D:/project')).toEqual([]);
  });

  it('isolates project memory to the current workspace', () => {
    expect(resolveAgentMemoryPaths(agent('project'), 'D:/project')).toEqual(['D:/project']);
    expect(resolveAgentMemoryPaths(agent('project'), null)).toEqual([]);
  });

  it('isolates user memory to the global memory directory', () => {
    expect(resolveAgentMemoryPaths(agent('user'), 'D:/project')).toEqual([null]);
  });

  it('isolates employee project memory by deployment and workspace', () => {
    useEmployeeDeploymentStore.setState({
      deployments: {
        dep_a: {
          packageId: 'employee-a',
          deploymentId: 'dep_a',
          agentName: 'employee-a',
          workspacePath: 'D:/project',
          conversationId: 'conv_a',
          configuredAt: 1,
        },
        dep_b: {
          packageId: 'employee-a',
          deploymentId: 'dep_b',
          agentName: 'employee-a',
          workspacePath: 'D:/project',
          conversationId: 'conv_b',
          configuredAt: 1,
        },
      },
    });

    const a = resolveEmployeeMemoryPath(employee('employee-a', 'project'), 'D:/project', 'conv_a');
    const b = resolveEmployeeMemoryPath(employee('employee-a', 'project'), 'D:/project', 'conv_b');
    expect(a).toContain('deployment/dep_a/project/D:/project');
    expect(b).toContain('deployment/dep_b/project/D:/project');
    expect(a).not.toBe(b);
  });

  it('uses an employee-local namespace when no platform deployment is bound', () => {
    expect(resolveEmployeeMemoryPath(employee('employee-a', 'user'), 'D:/project', 'conv_local'))
      .toBe('uprow-employee-memory://local/employee-a/user');
  });

  it('fails closed when one conversation has duplicate deployment bindings', () => {
    const record = {
      packageId: 'employee-a',
      agentName: 'employee-a',
      workspacePath: 'D:/project',
      conversationId: 'conv_a',
      configuredAt: 1,
    };
    useEmployeeDeploymentStore.setState({
      deployments: {
        dep_a: { ...record, deploymentId: 'dep_a' },
        dep_b: { ...record, deploymentId: 'dep_b' },
      },
    });

    expect(() => resolveEmployeeMemoryPath(employee('employee-a', 'project'), 'D:/project', 'conv_a'))
      .toThrow(EmployeeMemoryIsolationError);
  });
});
