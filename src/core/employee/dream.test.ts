import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, SubagentDefinition } from '@/types';

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  state: { conversationIndex: {}, conversations: {} } as Record<string, unknown>,
  extract: vi.fn(async () => ({ candidates: 1, written: 1, proposed: 0, safetyBlocked: 0, replaced: 0 })),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (path: string) => mocks.files.has(path),
  readTextFile: async (path: string) => mocks.files.get(path) ?? '',
  mkdir: async () => undefined,
}));
vi.mock('@/utils/atomicFs', () => ({
  atomicWrite: async (path: string, content: string) => { mocks.files.set(path, content); },
}));
vi.mock('@/stores/chatStore', () => ({
  useChatStore: { getState: () => mocks.state },
}));
vi.mock('../agent/employeeMemory', () => ({
  resolveEmployeeMemoryPath: () => 'employee-private-key',
}));
vi.mock('../session/conversationStorage', () => ({ loadMessages: async () => [] }));
vi.mock('../memdir/paths', () => ({ getMemoryDir: async () => '/memory/employee' }));
vi.mock('../memdir/extractor', async (importOriginal) => {
  const original = await importOriginal<typeof import('../memdir/extractor')>();
  return { ...original, extractMemoriesFromConversation: mocks.extract };
});
import { runEmployeeDream } from './dream';

function messages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `第 ${index + 1} 条历史消息，包含足够长且可用于员工自省的稳定工作反馈和上下文。`,
    timestamp: index + 1,
  } as Message));
}

function agent(schedule: 'daily' | 'manual'): SubagentDefinition {
  return {
    name: 'employee-a',
    description: 'Employee',
    systemPrompt: 'Work.',
    filePath: 'employee.md',
    source: 'employee',
    memory: 'project',
    memoryAutoCapture: ['feedback'],
    memoryWrites: 'approval',
    dream: { enabled: true, schedule, sessionScan: { maxSessions: 5 } },
  };
}

describe('employee Dream', () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.extract.mockClear();
    mocks.state = { conversationIndex: {}, conversations: {} };
  });

  it('runs manual reflection over the current employee conversation', async () => {
    mocks.state = {
      conversationIndex: {},
      conversations: {
        conv: {
          id: 'conv',
          title: '客户周报',
          createdAt: 1,
          updatedAt: 2,
          messages: messages(6),
        },
      },
    };

    const result = await runEmployeeDream({
      agent: agent('manual'),
      conversationId: 'conv',
      workspacePath: '/workspace',
      force: true,
    });

    expect(result.status).toBe('completed');
    expect(mocks.extract).toHaveBeenCalledWith('conv', '/workspace', expect.objectContaining({
      mode: 'dream',
      memoryPath: 'employee-private-key',
      writeMode: 'approval',
    }));
  });

  it('runs daily at most once and excludes the latest auto-capture window', async () => {
    mocks.state = {
      conversationIndex: {
        conv: {
          id: 'conv',
          title: '长期项目',
          createdAt: 1,
          updatedAt: 2,
          messageCount: 24,
          workspacePath: '/workspace',
          agentName: 'employee-a',
        },
      },
      conversations: {
        conv: {
          id: 'conv',
          title: '长期项目',
          createdAt: 1,
          updatedAt: 2,
          messages: messages(24),
        },
      },
    };

    await expect(runEmployeeDream({
      agent: agent('daily'),
      conversationId: 'conv',
      workspacePath: '/workspace',
    })).resolves.toMatchObject({ status: 'completed' });
    await expect(runEmployeeDream({
      agent: agent('daily'),
      conversationId: 'conv',
      workspacePath: '/workspace',
    })).resolves.toEqual({ status: 'not-due' });
    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.extract.mock.calls[0]?.[2]?.transcript).toContain('第 4 条历史消息');
    expect(mocks.extract.mock.calls[0]?.[2]?.transcript).not.toContain('第 24 条历史消息');
  });
});
