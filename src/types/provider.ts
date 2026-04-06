// ============================================================
// ABU — Provider & Model Type Definitions (V2)
// ============================================================

import type { ApiFormat, ProviderCapabilities } from './index';
import type { WebSearchProviderType } from '../core/search/providers';

/** Provider source */
export type ProviderSource = 'builtin' | 'custom';

/** Provider connection status */
export type ProviderStatus = 'unchecked' | 'checking' | 'verified' | 'failed';

/** Model capability tags */
export type ModelCapability = 'vision' | 'tool_use' | 'web_search' | 'image_gen' | 'thinking' | 'long_context';

/** Unified model definition */
export interface ModelInfo {
  id: string;
  label: string;
  capabilities?: ModelCapability[];
  contextWindow?: number;
  isCustom?: boolean;
}

/** Unified Provider instance (builtin and custom share the same structure) */
export interface ProviderInstance {
  id: string;
  source: ProviderSource;
  name: string;
  enabled: boolean;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string;
  models: ModelInfo[];
  defaultModelId?: string;
  capabilities?: ProviderCapabilities;
  status: ProviderStatus;
  statusMessage?: string;
  statusLatency?: number;
  lastChecked?: number;
  sortOrder: number;
}

/** Currently active model selection */
export interface ActiveModel {
  providerId: string;
  modelId: string;
}

/** Auxiliary capability service configuration */
export interface AuxiliaryServices {
  webSearch?: {
    provider: WebSearchProviderType;
    apiKey: string;
    baseUrl: string;
  };
  imageGen?: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

/** Provider usage guide */
export interface ProviderGuide {
  steps: string[];
  url: string;
  urlLabel: string;
}
