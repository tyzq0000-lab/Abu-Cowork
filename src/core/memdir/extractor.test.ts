import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  response: '[]',
  writeMemory: vi.fn(async () => 'memory.md'),
  deleteMemory: vi.fn(async () => undefined),
  createProposal: vi.fn(async () => ({ id: 'proposal-1' })),
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      conversations: {
        conv: {
          messages: [
            { id: '1', role: 'user', content: '第一条足够长的用户消息，用于员工长期记忆提取。' },
            { id: '2', role: 'assistant', content: '第一条足够长的助手回答，用于员工长期记忆提取。' },
            { id: '3', role: 'user', content: '第二条足够长的用户消息，包含稳定偏好。' },
            { id: '4', role: 'assistant', content: '第二条足够长的助手回答。' },
          ],
        },
      },
    }),
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({}) },
  getActiveApiKey: () => 'test-key',
  getActiveProvider: () => ({ apiFormat: 'anthropic' }),
  getEffectiveModel: () => 'test-model',
}));

vi.mock('../llm/claude', () => ({
  ClaudeAdapter: class {
    async chat(
      _messages: unknown,
      _options: unknown,
      onEvent: (event: { type: 'text'; text: string }) => void,
    ) {
      onEvent({ type: 'text', text: mocks.response });
    }
  },
}));
vi.mock('../llm/openai-compatible', () => ({
  OpenAICompatibleAdapter: class {
    async chat(
      _messages: unknown,
      _options: unknown,
      onEvent: (event: { type: 'text'; text: string }) => void,
    ) {
      onEvent({ type: 'text', text: mocks.response });
    }
  },
}));
vi.mock('../employee/platformRelay', () => ({ resolvePlatformRelayExecution: async () => null }));
vi.mock('./scan', () => ({ scanMemoryFiles: async () => [] }));
vi.mock('./write', () => ({
  writeMemory: mocks.writeMemory,
  deleteMemory: mocks.deleteMemory,
}));
vi.mock('../approval/reviewQueue', () => ({ createMemoryReviewProposal: mocks.createProposal }));

import {
  extractMemoriesFromConversation,
  normalizeExtractedMemory,
} from './extractor';

describe('employee memory extraction policy', () => {
  beforeEach(() => {
    mocks.response = '[]';
    mocks.writeMemory.mockClear();
    mocks.deleteMemory.mockClear();
    mocks.createProposal.mockClear();
  });

  it('maps only explicitly allowed package capture categories', () => {
    expect(normalizeExtractedMemory({
      name: '偏好',
      content: '先给摘要',
      capture: 'preference',
      type: 'project',
    }, ['preference'])).toMatchObject({ type: 'user' });
    expect(normalizeExtractedMemory({
      name: '项目',
      content: '不应通过',
      capture: 'project',
    }, ['preference'])).toBeNull();
  });

  it('writes automatic captures only into the employee-private memdir', async () => {
    mocks.response = JSON.stringify([
      { name: '摘要偏好', content: '客户要求先给三行摘要。', capture: 'preference' },
      { name: '项目动态', content: '本周完成上线。', capture: 'project' },
    ]);

    const result = await extractMemoriesFromConversation('conv', '/workspace', {
      memoryPath: 'uprow-employee-memory://deployment/dep_a/project/workspace',
      allowedCaptures: ['preference'],
      writeMode: 'auto',
      agentName: 'employee-a',
    });

    expect(result).toMatchObject({ candidates: 1, written: 1, proposed: 0 });
    expect(mocks.writeMemory).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user',
      workspacePath: 'uprow-employee-memory://deployment/dep_a/project/workspace',
    }));
  });

  it('routes approval-mode captures to Review Queue without writing memdir', async () => {
    mocks.response = JSON.stringify([
      { name: '失败规避', content: '导入失败后先检查文件编码。', capture: 'failure' },
    ]);

    const result = await extractMemoriesFromConversation('conv', '/workspace', {
      memoryPath: 'uprow-employee-memory://local/employee-a/project/workspace',
      allowedCaptures: ['failure'],
      writeMode: 'approval',
      agentName: 'employee-a',
    });

    expect(result).toMatchObject({ candidates: 1, written: 0, proposed: 1 });
    expect(mocks.writeMemory).not.toHaveBeenCalled();
    expect(mocks.createProposal).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feedback',
      agentName: 'employee-a',
    }));
  });
});
