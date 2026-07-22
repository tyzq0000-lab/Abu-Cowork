import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  resolvePlatformRelayExecution: vi.fn(),
}));

vi.mock('./openai-compatible', () => ({
  OpenAICompatibleAdapter: class {
    chat = mocks.chat;
  },
}));
vi.mock('./claude', () => ({
  ClaudeAdapter: class {
    chat = mocks.chat;
  },
}));
vi.mock('../employee/platformRelay', () => ({
  resolvePlatformRelayExecution: mocks.resolvePlatformRelayExecution,
}));
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ activeModel: { providerId: 'personal', modelId: 'personal-model' } }) },
  getActiveProvider: () => ({ apiFormat: 'anthropic', apiKey: 'personal-key', baseUrl: 'https://personal.example.com' }),
  getActiveApiKey: () => 'personal-key',
  getEffectiveModel: () => 'personal-model',
}));

import { llmCall } from './llmCall';

describe('llmCall platform binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.mockImplementation(async (_messages, _options, onEvent) => {
      onEvent({ type: 'text', text: 'relay-result' });
    });
  });

  it('uses the deployment relay when a conversation is platform-bound', async () => {
    mocks.resolvePlatformRelayExecution.mockResolvedValue({
      modelId: 'relay-model',
      provider: {
        apiFormat: 'openai-compatible',
        apiKey: 'deployment-secret',
        baseUrl: 'https://uprow.example.com/api/relay',
      },
    });

    await expect(llmCall({
      conversationId: 'conv-platform',
      employeeName: 'platform-agent',
      messages: [{ role: 'user', content: 'check' }],
    })).resolves.toMatchObject({ text: 'relay-result' });
    expect(mocks.resolvePlatformRelayExecution).toHaveBeenCalledWith('conv-platform', {
      agentName: 'platform-agent',
    });
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        model: 'relay-model',
        apiKey: 'deployment-secret',
        baseUrl: 'https://uprow.example.com/api/relay',
      }),
      expect.any(Function),
    );
  });

  it('does not fall back when the deployment binding is unavailable', async () => {
    mocks.resolvePlatformRelayExecution.mockRejectedValue(new Error('deployment unavailable'));
    await expect(llmCall({
      conversationId: 'conv-platform',
      messages: [{ role: 'user', content: 'check' }],
    })).rejects.toThrow('deployment unavailable');
    expect(mocks.chat).not.toHaveBeenCalled();
  });
});
