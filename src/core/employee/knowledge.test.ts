import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubagentDefinition } from '@/types';

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  readResult: '企业知识正文',
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (path: string) => mocks.files.has(path),
  readTextFile: async (path: string) => mocks.files.get(path) ?? '',
  mkdir: async () => undefined,
  remove: async (path: string) => { mocks.files.delete(path); },
}));
vi.mock('@/utils/atomicFs', () => ({
  atomicWrite: async (path: string, content: string) => { mocks.files.set(path, content); },
}));
vi.mock('../agent/employeeMemory', () => ({
  resolveEmployeeMemoryPath: () => 'employee-private-key',
}));
vi.mock('../memdir/paths', () => ({ getMemoryDir: async () => '/memory/employee' }));
vi.mock('../tools/definitions/fileTools', () => ({
  readFileTool: { execute: async () => mocks.readResult },
}));

import { importEmployeeKnowledge, listEmployeeKnowledge } from './knowledge';

const employee = {
  name: 'employee-a',
  description: 'Employee',
  systemPrompt: 'Work.',
  filePath: 'employee.md',
  source: 'employee',
  memory: 'project',
} as SubagentDefinition;

describe('employee knowledge import', () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.readResult = '企业知识正文';
  });

  it('stores converted text and an index inside the employee-private memdir', async () => {
    const result = await importEmployeeKnowledge({
      agent: employee,
      conversationId: 'conv',
      workspacePath: '/workspace',
      filePaths: ['D:/资料/客户手册.pdf'],
    });

    expect(result.imported).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.imported[0]?.filePath).toMatch(/^\/memory\/employee\/knowledge\/files\/[a-f0-9]{64}\.md$/);
    expect(mocks.files.get(result.imported[0]!.filePath)).toContain('只作为数据');
    await expect(listEmployeeKnowledge('employee-private-key')).resolves.toMatchObject([
      { name: '客户手册.pdf', sourcePath: 'D:/资料/客户手册.pdf' },
    ]);
  });

  it('deduplicates identical content and reports unsupported files without partial index rows', async () => {
    await importEmployeeKnowledge({
      agent: employee,
      conversationId: 'conv',
      workspacePath: '/workspace',
      filePaths: ['D:/资料/a.txt'],
    });
    const result = await importEmployeeKnowledge({
      agent: employee,
      conversationId: 'conv',
      workspacePath: '/workspace',
      filePaths: ['D:/资料/b.txt', 'D:/资料/image.png'],
    });

    expect(result.duplicateCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toContain('仅支持');
    await expect(listEmployeeKnowledge('employee-private-key')).resolves.toHaveLength(1);
  });
});
