import { describe, expect, it } from 'vitest';
import type { SubagentDefinition } from '@/types';
import { resolveAgentMemoryPaths } from './employeeMemory';

function agent(memory: SubagentDefinition['memory']): SubagentDefinition {
  return {
    name: 'employee',
    description: 'Employee',
    systemPrompt: 'Work.',
    filePath: 'employee.md',
    memory,
  };
}

describe('resolveAgentMemoryPaths', () => {
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
});
