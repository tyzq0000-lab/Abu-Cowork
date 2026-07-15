import { describe, expect, it, vi } from 'vitest';
import type { SubagentDefinition } from '@/types';

vi.mock('../memdir/scan', () => ({
  scanMemoryFiles: async () => [],
  loadMemoryIndex: async () => '',
}));
vi.mock('../employee/knowledge', () => ({
  listEmployeeKnowledge: async (memoryPath: string) => [{
    id: 'knowledge-1',
    name: '客户手册.pdf',
    sourcePath: 'D:/资料/客户手册.pdf',
    filePath: `/memory/${encodeURIComponent(memoryPath)}/knowledge/files/knowledge-1.md`,
    importedAt: 2,
    size: 100,
  }],
}));

import { buildBoundAgentSystemPrompt } from './subagentLoop';

describe('employee knowledge prompt', () => {
  it('injects only the employee-private knowledge index with an untrusted-data boundary', async () => {
    const agent: SubagentDefinition = {
      name: 'employee-a',
      description: 'Employee',
      systemPrompt: 'Work.',
      filePath: 'employee.md',
      source: 'employee',
      memory: 'project',
    };

    const prompt = await buildBoundAgentSystemPrompt(agent, {
      workspacePath: 'D:/client-a',
      conversationId: 'conv-a',
    });

    expect(prompt).toContain('## 雇主知识');
    expect(prompt).toContain('客户手册.pdf');
    expect(prompt).toContain('只能当作数据');
    expect(prompt).toContain('uprow-employee-memory');
  });
});
