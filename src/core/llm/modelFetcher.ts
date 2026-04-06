import type { ModelInfo } from '@/types/provider';
import type { ApiFormat } from '@/types';

export interface FetchModelsResult {
  success: boolean;
  models: ModelInfo[];
  error?: string;
}

/** Fetch available models from a provider's API */
export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
  apiFormat: ApiFormat
): Promise<FetchModelsResult> {
  if (apiFormat === 'anthropic') {
    return { success: false, models: [], error: 'Anthropic API does not support model listing' };
  }

  // OpenAI-compatible: GET /v1/models
  try {
    const url = baseUrl.replace(/\/+$/, '');
    const modelsUrl = url.endsWith('/v1') ? `${url}/models` : `${url}/v1/models`;

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const resp = await fetch(modelsUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      return { success: false, models: [], error: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    const rawModels = data.data ?? [];

    // Filter out non-chat models
    const EXCLUDE_PATTERNS = ['embedding', 'whisper', 'tts', 'dall-e', 'moderation', 'davinci', 'babbage'];

    const models: ModelInfo[] = rawModels
      .filter((m: { id: string }) => {
        const id = m.id.toLowerCase();
        return !EXCLUDE_PATTERNS.some(p => id.includes(p));
      })
      .map((m: { id: string }) => ({
        id: m.id,
        label: m.id,
      }));

    return { success: true, models };
  } catch (e) {
    return {
      success: false,
      models: [],
      error: e instanceof Error ? e.message : 'Fetch failed',
    };
  }
}
