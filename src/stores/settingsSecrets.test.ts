import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInstance } from '@/types/provider';

const { getSecret } = vi.hoisted(() => ({
  getSecret: vi.fn<(key: string) => Promise<string | null>>(),
}));

vi.mock('@/utils/secretStore', () => ({
  SECRET_KEYS: {
    provider: (id: string) => `provider:${id}`,
    auxWebSearch: 'aux:webSearch',
    auxImageGen: 'aux:imageGen',
  },
  getSecret,
  setSecret: vi.fn(() => Promise.resolve()),
  deleteSecret: vi.fn(() => Promise.resolve()),
  listFailedSecrets: vi.fn(() => Promise.resolve([])),
  writeSecretOrDelete: vi.fn(() => Promise.resolve()),
}));

import { bootstrapSecrets, useSettingsStore } from './settingsStore';

function provider(overrides: Partial<ProviderInstance>): ProviderInstance {
  return {
    id: 'provider',
    source: 'builtin',
    name: 'Provider',
    enabled: false,
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.example.com',
    apiKey: '',
    models: [{ id: 'model', label: 'Model' }],
    status: 'unchecked',
    sortOrder: 0,
    ...overrides,
  };
}

describe('secret hydration model reconciliation', () => {
  beforeEach(() => {
    getSecret.mockReset();
    getSecret.mockImplementation(async (key) => (
      key === 'provider:bailian' ? 'sk-bailian' : null
    ));
  });

  it('selects an enabled usable provider after its key is restored', async () => {
    useSettingsStore.setState({
      providers: [
        provider({ id: 'anthropic', enabled: false }),
        provider({
          id: 'bailian',
          enabled: true,
          models: [{ id: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' }],
        }),
      ],
      activeModel: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    });

    await bootstrapSecrets();

    const state = useSettingsStore.getState();
    expect(state.providers.find((item) => item.id === 'bailian')?.apiKey).toBe('sk-bailian');
    expect(state.activeModel).toEqual({
      providerId: 'bailian',
      modelId: 'qwen3.5-plus',
    });
  });
});

describe('provider toggle model reconciliation', () => {
  it('switches away when the active provider is disabled', () => {
    useSettingsStore.setState({
      providers: [
        provider({ id: 'anthropic', enabled: true, apiKey: 'sk-anthropic' }),
        provider({
          id: 'bailian',
          enabled: true,
          apiKey: 'sk-bailian',
          models: [{ id: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' }],
        }),
      ],
      activeModel: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    });

    useSettingsStore.getState().toggleProvider('anthropic');

    expect(useSettingsStore.getState().activeModel).toEqual({
      providerId: 'bailian',
      modelId: 'qwen3.5-plus',
    });
  });
});
