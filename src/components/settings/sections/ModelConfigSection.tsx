import { useSettingsStore, getEffectiveModel, getActiveApiKey, getActiveProvider } from '@/stores/settingsStore';
import { Eye, EyeOff, CircleCheck, CircleAlert, Thermometer, ChevronDown, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { Select } from '@/components/ui/select';
import type { SelectOptionGroup } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { checkOllamaHealth, fetchOllamaModels, formatOllamaModelLabel, formatModelSize } from '@/core/llm/ollama';
import type { OllamaModel, OllamaStatus } from '@/core/llm/ollama';

export default function ModelConfigSection() {
  const store = useSettingsStore();
  const {
    providers,
    activeModel,
    temperature,
    selectModel,
    updateProvider,
    setTemperature,
  } = store;

  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const effectiveModel = getEffectiveModel(store);
  const activeProvider = getActiveProvider(store);
  const apiKey = getActiveApiKey(store);
  const hasApiKey = apiKey.trim().length > 0;

  const isOllama = activeModel.providerId === 'ollama';
  const hasModel = !!effectiveModel;

  // ── Ollama state ──
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('unknown');
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const ollamaUrlRef = useRef(activeProvider?.baseUrl ?? '');
  ollamaUrlRef.current = activeProvider?.baseUrl ?? '';

  const refreshOllamaModels = useCallback(async () => {
    const url = ollamaUrlRef.current || 'http://localhost:11434';
    setOllamaLoading(true);
    setOllamaStatus('checking');
    try {
      const online = await checkOllamaHealth(url);
      if (!online) {
        setOllamaStatus('offline');
        setOllamaModels([]);
        setOllamaLoading(false);
        return;
      }
      setOllamaStatus('online');
      const models = await fetchOllamaModels(url);
      setOllamaModels(models);
      // Auto-select first model if current model is empty or not in the list
      if (models.length > 0) {
        const current = useSettingsStore.getState().activeModel.modelId;
        const isInList = models.some((m) => m.name === current);
        if (!current || !isInList) {
          selectModel('ollama', models[0].name);
        }
      }
    } catch {
      setOllamaStatus('offline');
      setOllamaModels([]);
    } finally {
      setOllamaLoading(false);
    }
  }, [selectModel]);

  // Auto-detect when switching to Ollama provider
  useEffect(() => {
    if (isOllama) {
      refreshOllamaModels();
    } else {
      setOllamaStatus('unknown');
      setOllamaModels([]);
    }
  }, [isOllama, refreshOllamaModels]);

  // Build grouped provider options from providers array
  const providerOptions = useMemo(() => {
    const builtinProviders = providers.filter(p => p.source === 'builtin' && p.id !== 'ollama');
    const localProviders = providers.filter(p => p.id === 'ollama');
    const customProviders = providers.filter(p => p.source === 'custom');

    const groups: SelectOptionGroup[] = [
      {
        label: t.settings.builtinProviders,
        options: builtinProviders.map(p => ({ value: p.id, label: p.name })),
      },
    ];

    if (localProviders.length > 0) {
      groups.push({
        label: t.settings.localModelsGroup,
        options: localProviders.map(p => ({ value: p.id, label: p.name })),
      });
    }

    if (customProviders.length > 0) {
      groups.push({
        label: t.settings.myCustomServices,
        options: customProviders.map(p => ({ value: p.id, label: p.name })),
      });
    }

    return groups;
  }, [providers, t]);

  const handleProviderChange = (value: string) => {
    const provider = providers.find(p => p.id === value);
    if (provider) {
      // Select the first model of the new provider
      const firstModel = provider.models[0]?.id ?? '';
      selectModel(provider.id, firstModel);
    }
  };

  const handleApiKeyChange = (value: string) => {
    if (activeProvider) {
      updateProvider(activeProvider.id, { apiKey: value });
    }
  };

  const handleBaseUrlChange = (value: string) => {
    if (activeProvider) {
      updateProvider(activeProvider.id, { baseUrl: value });
    }
  };

  // Available model list from the active provider
  const availableModels = (activeProvider?.models ?? []).map(m => ({ value: m.id, label: m.label }));

  return (
    <div className="space-y-5">
      {/* Current config status */}
      <div className="p-4 bg-[var(--abu-bg-muted)] rounded-xl space-y-3">
        <h4 className="text-xs font-medium text-[var(--abu-text-tertiary)] uppercase tracking-wider">{t.settings.currentConfig}</h4>
        <div className="space-y-2 text-sm">
          {isOllama ? (
            /* Ollama: show connection status instead of API key */
            <div className="flex items-center gap-2">
              {ollamaStatus === 'online' ? (
                <Wifi className="h-4 w-4 text-green-600 flex-none" />
              ) : ollamaStatus === 'checking' ? (
                <RefreshCw className="h-4 w-4 text-[var(--abu-text-muted)] flex-none animate-spin" />
              ) : (
                <WifiOff className="h-4 w-4 text-amber-500 flex-none" />
              )}
              <span className="text-[var(--abu-text-tertiary)]">{t.settings.ollamaStatus}:</span>
              <span className={cn(
                ollamaStatus === 'online' ? 'text-green-600' : ollamaStatus === 'checking' ? 'text-[var(--abu-text-muted)]' : 'text-amber-600',
                'font-medium'
              )}>
                {ollamaStatus === 'online' ? t.settings.ollamaOnline
                  : ollamaStatus === 'checking' ? t.settings.ollamaChecking
                  : t.settings.ollamaOffline}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {hasApiKey ? (
                <CircleCheck className="h-4 w-4 text-green-600 flex-none" />
              ) : (
                <CircleAlert className="h-4 w-4 text-amber-500 flex-none" />
              )}
              <span className="text-[var(--abu-text-tertiary)]">{t.settings.apiKey}:</span>
              <span className={cn(hasApiKey ? 'text-green-600' : 'text-amber-600', 'font-medium')}>
                {hasApiKey ? t.settings.configured : t.settings.notConfigured}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4 text-green-600 flex-none" />
            <span className="text-[var(--abu-text-tertiary)]">{t.settings.provider}:</span>
            <span className="text-[var(--abu-text-primary)] font-medium">
              {activeProvider?.name ?? '-'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasModel ? (
              <CircleCheck className="h-4 w-4 text-green-600 flex-none" />
            ) : (
              <CircleAlert className="h-4 w-4 text-amber-500 flex-none" />
            )}
            <span className="text-[var(--abu-text-tertiary)]">{t.settings.model}:</span>
            <span className={cn(hasModel ? 'text-[var(--abu-text-primary)]' : 'text-amber-600', 'font-medium truncate')}>
              {effectiveModel || t.settings.notSet}
            </span>
          </div>
        </div>
      </div>

      {/* Provider selector (grouped) */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--abu-text-tertiary)] font-medium">{t.settings.provider}</label>
        <Select
          value={activeModel.providerId}
          options={providerOptions}
          onChange={handleProviderChange}
          placeholder={t.settings.selectProvider}
        />
      </div>

      {/* ── Ollama-specific sections ── */}
      {isOllama && (
        <>
          {/* Ollama URL */}
          <div className="space-y-2">
            <label className="text-xs text-[var(--abu-text-tertiary)] font-medium">{t.settings.ollamaUrlLabel}</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={activeProvider?.baseUrl ?? ''}
                onChange={(e) => handleBaseUrlChange(e.target.value)}
                placeholder="http://localhost:11434"
                className="flex-1"
              />
              <button
                onClick={refreshOllamaModels}
                disabled={ollamaLoading}
                className={cn(
                  'h-9 px-3 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
                  'bg-[var(--abu-bg-muted)] text-[var(--abu-text-tertiary)] hover:bg-[var(--abu-bg-hover)]',
                  ollamaLoading && 'opacity-50 cursor-not-allowed'
                )}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', ollamaLoading && 'animate-spin')} />
              </button>
            </div>
            <p className="text-xs text-[var(--abu-text-muted)]">{t.settings.ollamaUrlHint}</p>
          </div>

          {/* Ollama model selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-[var(--abu-text-tertiary)] font-medium">{t.settings.model}</label>
              {ollamaModels.length > 0 && (
                <span className="text-xs text-[var(--abu-text-muted)]">
                  {ollamaModels.length} {ollamaModels.length === 1 ? 'model' : 'models'}
                </span>
              )}
            </div>
            {ollamaStatus === 'online' && ollamaModels.length > 0 ? (
              <Select
                value={activeModel.modelId}
                options={ollamaModels.map((m) => ({
                  value: m.name,
                  label: formatOllamaModelLabel(m),
                }))}
                onChange={(v) => selectModel('ollama', v)}
                placeholder={t.settings.selectModel}
              />
            ) : ollamaStatus === 'online' && ollamaModels.length === 0 ? (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-sm font-medium text-amber-600">{t.settings.ollamaNoModels}</p>
                <p className="text-xs text-[var(--abu-text-muted)] mt-1">{t.settings.ollamaNoModelsHint}</p>
              </div>
            ) : ollamaStatus === 'offline' ? (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{t.settings.ollamaOffline}</p>
                <p className="text-xs text-[var(--abu-text-muted)] mt-1">
                  {t.settings.ollamaUrlHint}
                </p>
              </div>
            ) : null}

            {/* Show selected model details */}
            {isOllama && activeModel.modelId && ollamaModels.length > 0 && (() => {
              const selected = ollamaModels.find((m) => m.name === activeModel.modelId);
              if (!selected) return null;
              return (
                <div className="flex items-center gap-3 text-xs text-[var(--abu-text-muted)]">
                  <span>{t.settings.ollamaModelSize}: {formatModelSize(selected.size)}</span>
                  {selected.details.family && <span>Family: {selected.details.family}</span>}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* Model selector (built-in providers, not Ollama which has its own) */}
      {!isOllama && availableModels.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-[var(--abu-text-tertiary)] font-medium">{t.settings.model}</label>
          <Select
            value={activeModel.modelId}
            options={availableModels}
            onChange={(v) => selectModel(activeModel.providerId, v)}
            placeholder={t.settings.selectModel}
          />
        </div>
      )}

      {/* API Key (hidden for Ollama — no auth needed) */}
      {!isOllama && (
        <div className="space-y-2">
          <label className="text-xs text-[var(--abu-text-tertiary)] font-medium">{t.settings.apiKey} <span className="text-red-400">*</span></label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="sk-..."
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[var(--abu-text-muted)] hover:text-[var(--abu-text-tertiary)] transition-colors"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-[var(--abu-text-muted)]">{t.settings.apiKeyDesc}</p>
        </div>
      )}

      {/* Advanced parameters */}
      <div className="border border-[var(--abu-border)] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-3 bg-[var(--abu-bg-muted)] hover:bg-[var(--abu-bg-hover)] transition-colors"
        >
          <span className="text-sm font-medium text-[var(--abu-text-primary)]">{t.settings.advanced}</span>
          <ChevronDown className={cn('h-4 w-4 text-[var(--abu-text-muted)] transition-transform', showAdvanced && 'rotate-180')} />
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 space-y-4 bg-[var(--abu-bg-muted)] border-t border-[var(--abu-border)]">
            {/* Temperature */}
            <div className="space-y-2 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[var(--abu-text-tertiary)] font-medium flex items-center gap-1.5">
                  <Thermometer className="h-3.5 w-3.5" />
                  {t.settings.temperature}
                </label>
                <span className="text-xs font-mono text-[var(--abu-text-primary)]">{temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full slider-filled"
                style={{ '--slider-progress': `${temperature * 100}%` } as React.CSSProperties}
              />
              <div className="flex justify-between text-[10px] text-[var(--abu-text-muted)]">
                <span>{t.settings.temperaturePrecise}</span>
                <span>{t.settings.temperatureCreative}</span>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
