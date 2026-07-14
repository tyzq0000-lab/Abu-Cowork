import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllEnabledModels,
  hasUsableEmployeeProvider,
  reconcileActiveProvider,
  resolveAgentExecution,
  selectUserProviders,
  useSettingsStore,
} from './settingsStore';
import type { ProviderInstance, ActiveModel } from '@/types/provider';

// ─── Test fixture helpers ─────────────────────────────────────

function makeProvider(overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: 'p1',
    source: 'builtin',
    name: 'Provider 1',
    enabled: true,
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test',
    models: [{ id: 'm1', label: 'Model 1' }],
    status: 'unchecked',
    sortOrder: 0,
    ...overrides,
  };
}

function makeState(
  providers: ProviderInstance[],
  activeModel: ActiveModel,
): { providers: ProviderInstance[]; activeModel: ActiveModel } {
  return { providers, activeModel };
}

describe('reconcileActiveProvider', () => {
  // ─── Branch 1: active provider exists and is enabled — no-op ───
  describe('when active provider is enabled', () => {
    it('leaves state unchanged', () => {
      const p = makeProvider({ id: 'p1', enabled: true, apiKey: 'key' });
      const state = makeState([p], { providerId: 'p1', modelId: 'm1' });
      const before = JSON.parse(JSON.stringify(state));

      reconcileActiveProvider(state);

      expect(state).toEqual(before);
    });
  });

  // ─── Branch 2: active provider missing entirely ───
  describe('when active provider does not exist in providers[]', () => {
    it('switches to first usable enabled provider (has key)', () => {
      const usable = makeProvider({
        id: 'usable',
        enabled: true,
        apiKey: 'key',
        models: [{ id: 'usable-m1', label: 'M1' }],
      });
      const enabledNoKey = makeProvider({
        id: 'enabled-no-key',
        enabled: true,
        apiKey: '',
        sortOrder: 1,
      });
      const state = makeState(
        [enabledNoKey, usable],
        { providerId: 'ghost', modelId: 'gone' },
      );

      reconcileActiveProvider(state);

      expect(state.activeModel).toEqual({
        providerId: 'usable',
        modelId: 'usable-m1',
      });
    });

    it('falls back to ollama (no key needed) if available', () => {
      const ollama = makeProvider({
        id: 'ollama',
        enabled: true,
        apiKey: '',
        models: [{ id: 'llama3', label: 'Llama 3' }],
      });
      const state = makeState([ollama], { providerId: 'ghost', modelId: 'gone' });

      reconcileActiveProvider(state);

      expect(state.activeModel).toEqual({
        providerId: 'ollama',
        modelId: 'llama3',
      });
    });

    it('falls back to any enabled provider if no usable one exists', () => {
      const enabledNoKey = makeProvider({
        id: 'p1',
        enabled: true,
        apiKey: '',
        models: [{ id: 'm1', label: 'M1' }],
      });
      const state = makeState([enabledNoKey], { providerId: 'ghost', modelId: 'gone' });

      reconcileActiveProvider(state);

      expect(state.activeModel).toEqual({
        providerId: 'p1',
        modelId: 'm1',
      });
    });

    it('leaves activeModel untouched if no enabled provider exists at all', () => {
      const disabled = makeProvider({ id: 'p1', enabled: false, apiKey: 'key' });
      const state = makeState([disabled], { providerId: 'ghost', modelId: 'gone' });

      reconcileActiveProvider(state);

      // No usable fallback — activeModel preserved (caller can detect via getActiveProvider returning undefined)
      expect(state.activeModel).toEqual({ providerId: 'ghost', modelId: 'gone' });
      // Importantly: does NOT silently force-enable a random disabled provider
      expect(state.providers[0].enabled).toBe(false);
    });

    it('handles provider with empty models array gracefully', () => {
      const noModels = makeProvider({
        id: 'p1',
        enabled: true,
        apiKey: 'key',
        models: [],
      });
      const state = makeState([noModels], { providerId: 'ghost', modelId: 'gone' });

      reconcileActiveProvider(state);

      expect(state.activeModel).toEqual({ providerId: 'p1', modelId: '' });
    });
  });

  // ─── Branch 3: active provider exists but is disabled, and is usable ───
  describe('when active provider is disabled but has a key', () => {
    it('silently re-enables it (preserves V14 default behavior)', () => {
      const p = makeProvider({ id: 'p1', enabled: false, apiKey: 'key' });
      const state = makeState([p], { providerId: 'p1', modelId: 'm1' });

      reconcileActiveProvider(state);

      expect(state.providers[0].enabled).toBe(true);
      expect(state.activeModel).toEqual({ providerId: 'p1', modelId: 'm1' });
    });

    it('silently re-enables ollama even with empty key', () => {
      const p = makeProvider({ id: 'ollama', enabled: false, apiKey: '' });
      const state = makeState([p], { providerId: 'ollama', modelId: 'm1' });

      reconcileActiveProvider(state);

      expect(state.providers[0].enabled).toBe(true);
    });

    it('treats whitespace-only apiKey as empty (not usable)', () => {
      const whitespaceKey = makeProvider({
        id: 'p1',
        enabled: false,
        apiKey: '   ',
      });
      const usableFallback = makeProvider({
        id: 'p2',
        enabled: true,
        apiKey: 'real-key',
        models: [{ id: 'm2', label: 'M2' }],
      });
      const state = makeState(
        [whitespaceKey, usableFallback],
        { providerId: 'p1', modelId: 'm1' },
      );

      reconcileActiveProvider(state);

      // Whitespace key is NOT considered usable → switch to p2
      expect(state.activeModel).toEqual({ providerId: 'p2', modelId: 'm2' });
      expect(state.providers[0].enabled).toBe(false); // p1 stays disabled
    });
  });

  // ─── Branch 4: active provider disabled AND unusable — needs fallback ───
  describe('when active provider is disabled and has no key', () => {
    it('switches active to a usable enabled fallback, leaving original disabled', () => {
      const disabledNoKey = makeProvider({
        id: 'p1',
        enabled: false,
        apiKey: '',
      });
      const usable = makeProvider({
        id: 'p2',
        enabled: true,
        apiKey: 'key',
        models: [{ id: 'm2', label: 'M2' }],
      });
      const state = makeState(
        [disabledNoKey, usable],
        { providerId: 'p1', modelId: 'm1' },
      );

      reconcileActiveProvider(state);

      expect(state.activeModel).toEqual({ providerId: 'p2', modelId: 'm2' });
      // Critical: original active provider STAYS disabled — user intent preserved
      expect(state.providers[0].enabled).toBe(false);
    });

    it('prefers fallback that is usable over fallback that is enabled-but-keyless', () => {
      const disabledNoKey = makeProvider({ id: 'p1', enabled: false, apiKey: '' });
      const enabledNoKey = makeProvider({
        id: 'enabled-no-key',
        enabled: true,
        apiKey: '',
        sortOrder: 1,
      });
      const usable = makeProvider({
        id: 'usable',
        enabled: true,
        apiKey: 'key',
        models: [{ id: 'usable-m', label: 'UM' }],
        sortOrder: 2,
      });
      const state = makeState(
        [disabledNoKey, enabledNoKey, usable],
        { providerId: 'p1', modelId: 'm1' },
      );

      reconcileActiveProvider(state);

      // Should pick `usable`, NOT `enabled-no-key`
      expect(state.activeModel.providerId).toBe('usable');
    });

    it('leaves provider disabled when no fallback exists and provider has no key', () => {
      // New behavior: no force-enable if the active provider has no key.
      // This keeps the first-run banner visible so the user is guided to configure.
      const disabledNoKey = makeProvider({
        id: 'p1',
        enabled: false,
        apiKey: '',
      });
      const otherDisabled = makeProvider({
        id: 'p2',
        enabled: false,
        apiKey: 'key',
        sortOrder: 1,
      });
      const state = makeState(
        [disabledNoKey, otherDisabled],
        { providerId: 'p1', modelId: 'm1' },
      );

      reconcileActiveProvider(state);

      // No usable fallback (p2 is disabled) and p1 has no key →
      // leave disabled so the first-run banner keeps showing.
      expect(state.providers[0].enabled).toBe(false);
      expect(state.activeModel).toEqual({ providerId: 'p1', modelId: 'm1' });
      expect(state.providers[1].enabled).toBe(false); // p2 untouched
    });

    it('does not consider self as fallback (the id !== self guard)', () => {
      // Only provider has no key → stays disabled (no force-enable).
      const disabledNoKey = makeProvider({
        id: 'p1',
        enabled: false,
        apiKey: '',
      });
      const state = makeState([disabledNoKey], { providerId: 'p1', modelId: 'm1' });

      reconcileActiveProvider(state);

      expect(state.providers[0].enabled).toBe(false);
    });
  });

  // ─── User-reported scenario: V14 migration aftermath ───
  describe('regression scenarios', () => {
    it('handles "user disabled active, has another usable provider" (the original bug)', () => {
      // User had minimax (active) with key, then toggled it off to switch to didi
      // App restart → onRehydrateStorage runs
      const minimax = makeProvider({
        id: 'minimax',
        enabled: false, // user toggled off
        apiKey: '', // key was cleared at some point
      });
      const didi = makeProvider({
        id: 'didi',
        enabled: true,
        apiKey: 'didi-key',
        models: [{ id: 'glm-5', label: 'GLM 5' }],
      });
      const state = makeState(
        [minimax, didi],
        { providerId: 'minimax', modelId: 'm1' },
      );

      reconcileActiveProvider(state);

      // Active should switch to didi (the usable one), minimax stays disabled
      expect(state.activeModel.providerId).toBe('didi');
      expect(state.providers.find(p => p.id === 'minimax')!.enabled).toBe(false);
    });

    it('handles "qiniu placeholder + new minimax" V14 migration aftermath', () => {
      // V14 migration created qiniu (default active, enabled, no key)
      // User then added minimax with key
      // Active is still qiniu — onRehydrate should keep this state stable
      // because qiniu is still enabled, even though it has no key.
      const qiniu = makeProvider({
        id: 'qiniu',
        enabled: true, // default-enabled by V14
        apiKey: '',
      });
      const minimax = makeProvider({
        id: 'minimax',
        enabled: true,
        apiKey: 'mm-key',
        sortOrder: 1,
      });
      const state = makeState(
        [qiniu, minimax],
        { providerId: 'qiniu', modelId: 'm1' },
      );

      reconcileActiveProvider(state);

      // qiniu is enabled → branch 1 hit → no changes
      expect(state.activeModel).toEqual({ providerId: 'qiniu', modelId: 'm1' });
      expect(state.providers[0].enabled).toBe(true);
      // (The needsSetup banner is now correctly suppressed by the new
      // ChatView predicate because minimax has a key — that's tested
      // separately by ChatView, not here.)
    });
  });
});

// ─── Whitespace trimming at the store boundary ──────────────────
// Regression coverage for the trailing-space-in-baseUrl bug:
// users pasting URLs like "http://x.com/ " would hit /%20/v1/... 404s.
describe('settingsStore whitespace trim', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      providers: [],
      auxiliaryServices: {},
    });
  });

  describe('addProvider', () => {
    it('trims whitespace from baseUrl and apiKey on create', () => {
      const id = useSettingsStore.getState().addProvider({
        source: 'custom',
        name: 'test',
        enabled: true,
        apiFormat: 'openai-compatible',
        baseUrl: '  http://x.com/ ',
        apiKey: ' sk-test\n',
        models: [{ id: 'm1', label: 'M1' }],
      });
      const p = useSettingsStore.getState().providers.find((x) => x.id === id);
      expect(p?.baseUrl).toBe('http://x.com/');
      expect(p?.apiKey).toBe('sk-test');
    });
  });

  describe('updateProvider', () => {
    it('trims whitespace from baseUrl patch', () => {
      const id = useSettingsStore.getState().addProvider({
        source: 'custom',
        name: 'test',
        enabled: true,
        apiFormat: 'openai-compatible',
        baseUrl: 'http://x.com',
        apiKey: 'sk-test',
        models: [{ id: 'm1', label: 'M1' }],
      });
      useSettingsStore.getState().updateProvider(id, {
        baseUrl: '  http://y.com/ ',
        apiKey: ' sk-new ',
      });
      const p = useSettingsStore.getState().providers.find((x) => x.id === id);
      expect(p?.baseUrl).toBe('http://y.com/');
      expect(p?.apiKey).toBe('sk-new');
    });

    it('leaves other fields alone when patch omits baseUrl/apiKey', () => {
      const id = useSettingsStore.getState().addProvider({
        source: 'custom',
        name: 'test',
        enabled: true,
        apiFormat: 'openai-compatible',
        baseUrl: 'http://x.com',
        apiKey: 'sk-test',
        models: [{ id: 'm1', label: 'M1' }],
      });
      useSettingsStore.getState().updateProvider(id, { enabled: false });
      const p = useSettingsStore.getState().providers.find((x) => x.id === id);
      expect(p?.enabled).toBe(false);
      expect(p?.baseUrl).toBe('http://x.com');
      expect(p?.apiKey).toBe('sk-test');
    });
  });

  describe('setAuxiliaryWebSearch', () => {
    it('trims whitespace from baseUrl and apiKey', () => {
      useSettingsStore.getState().setAuxiliaryWebSearch({
        provider: 'tavily',
        apiKey: '  key-123 ',
        baseUrl: ' http://search.example.com/ ',
      });
      const cfg = useSettingsStore.getState().auxiliaryServices.webSearch;
      expect(cfg?.apiKey).toBe('key-123');
      expect(cfg?.baseUrl).toBe('http://search.example.com/');
    });
  });

  describe('setAuxiliaryImageGen', () => {
    it('trims whitespace from baseUrl and apiKey', () => {
      useSettingsStore.getState().setAuxiliaryImageGen({
        apiKey: ' imgkey ',
        baseUrl: '  http://img.example.com/ ',
        model: 'dall-e-3',
      });
      const cfg = useSettingsStore.getState().auxiliaryServices.imageGen;
      expect(cfg?.apiKey).toBe('imgkey');
      expect(cfg?.baseUrl).toBe('http://img.example.com/');
    });
  });
});

describe('employee dedicated providers (modelConfig injection)', () => {
  const MODEL_CONFIG = {
    provider: {
      apiFormat: 'openai-compatible' as const,
      baseUrl: 'https://maker.example.com/v1',
      model: 'deepseek-v3',
      apiKey: 'sk-maker',
    },
  };

  beforeEach(() => {
    useSettingsStore.setState({
      providers: [makeProvider({ id: 'global', apiKey: 'sk-global' })],
      activeModel: { providerId: 'global', modelId: 'm1' },
      auxiliaryServices: {},
    });
  });

  it('upsertEmployeeProvider registers a hidden employee provider', () => {
    const id = useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', MODEL_CONFIG);
    expect(id).toBe('employee:new-media-ops');

    const state = useSettingsStore.getState();
    const p = state.providers.find((x) => x.id === id)!;
    expect(p.source).toBe('employee');
    expect(p.enabled).toBe(true);
    expect(p.models).toEqual([{ id: 'deepseek-v3', label: 'deepseek-v3' }]);
    // Hidden from the model selector and never the global active provider.
    expect(getAllEnabledModels(state).some((e) => e.provider.id === id)).toBe(false);
    expect(state.activeModel.providerId).toBe('global');
  });

  it('selectUserProviders hides the employee provider from the AI-services UI', () => {
    // Regression: employee providers are enabled:true, so a naive
    // `userAdded || enabled || apiKey` filter would render their card and
    // leak the maker's model name / endpoint. AIServicesSection must derive
    // its list from selectUserProviders, which drops source === 'employee'.
    const id = useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', MODEL_CONFIG);
    const { providers } = useSettingsStore.getState();
    const visible = selectUserProviders(providers);
    expect(visible.some((p) => p.id === id)).toBe(false);
    expect(visible.some((p) => p.id === 'global')).toBe(true);
  });

  it('upsertEmployeeProvider is idempotent per employee (replaces, no duplicates)', () => {
    useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', MODEL_CONFIG);
    useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', {
      provider: { ...MODEL_CONFIG.provider, model: 'deepseek-v4' },
    });
    const matches = useSettingsStore
      .getState()
      .providers.filter((p) => p.id === 'employee:new-media-ops');
    expect(matches).toHaveLength(1);
    expect(matches[0].models[0].id).toBe('deepseek-v4');
  });

  it('reconcileActiveProvider never falls back onto an employee provider', () => {
    const employee = makeProvider({
      id: 'employee:x',
      source: 'employee',
      enabled: true,
      apiKey: 'sk-emp',
    });
    const state = makeState([employee], { providerId: 'gone', modelId: 'm1' });
    reconcileActiveProvider(state);
    expect(state.activeModel.providerId).toBe('gone'); // nothing eligible — unchanged
  });

  describe('hasUsableEmployeeProvider', () => {
    it('is false when only the global provider exists', () => {
      expect(hasUsableEmployeeProvider(useSettingsStore.getState())).toBe(false);
    });

    it('is true when an employee provider is enabled with a key', () => {
      useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', MODEL_CONFIG);
      expect(hasUsableEmployeeProvider(useSettingsStore.getState())).toBe(true);
    });

    it('is false when the only employee provider has an empty key', () => {
      useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', {
        provider: { ...MODEL_CONFIG.provider, apiKey: '' },
      });
      expect(hasUsableEmployeeProvider(useSettingsStore.getState())).toBe(false);
    });

    it('is false when the employee provider is disabled', () => {
      useSettingsStore.setState({
        providers: [
          makeProvider({ id: 'global', apiKey: 'sk-global' }),
          makeProvider({
            id: 'employee:x',
            source: 'employee',
            enabled: false,
            apiKey: 'sk-emp',
          }),
        ],
        activeModel: { providerId: 'global', modelId: 'm1' },
      });
      expect(hasUsableEmployeeProvider(useSettingsStore.getState())).toBe(false);
    });
  });

  describe('resolveAgentExecution', () => {
    it('routes to the dedicated provider when usable', () => {
      useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', MODEL_CONFIG);
      const target = resolveAgentExecution(
        { model: 'deepseek-v3', providerId: 'employee:new-media-ops' },
        useSettingsStore.getState(),
      )!;
      expect(target.provider.id).toBe('employee:new-media-ops');
      expect(target.modelId).toBe('deepseek-v3');
    });

    it('falls back to the global provider when the dedicated key is empty', () => {
      useSettingsStore.getState().upsertEmployeeProvider('new-media-ops', {
        provider: { ...MODEL_CONFIG.provider, apiKey: '' },
      });
      const target = resolveAgentExecution(
        { model: 'deepseek-v3', providerId: 'employee:new-media-ops' },
        useSettingsStore.getState(),
      )!;
      expect(target.provider.id).toBe('global');
    });

    it('uses global semantics for agents without a providerId', () => {
      const target = resolveAgentExecution({ model: 'inherit' }, useSettingsStore.getState())!;
      expect(target.provider.id).toBe('global');
      expect(target.modelId).toBe('m1');
    });
  });
});
