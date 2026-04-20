import type { ApiFormat } from '@/types';

/**
 * Remove surrounding whitespace and trailing slashes from a user-provided base URL.
 * Idempotent and safe on empty strings.
 */
export function normalizeBaseUrl(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Given a normalized base URL, return the value the OpenAI-compatible adapter
 * will actually POST to after its /v1 auto-append rule. Mirrors the logic in
 * openai-compatible.ts chat(). Keeps UI preview and real request in lockstep.
 */
export function resolveOpenAIBaseUrl(raw: string | undefined | null): string {
  let base = normalizeBaseUrl(raw) || 'https://api.openai.com/v1';
  if (!base.match(/\/v\d+$/)) base += '/v1';
  return base;
}

/**
 * Build the full chat endpoint URL the app will hit for a given provider config.
 * Used by the adapter (to POST) and by the settings UI (to preview for the user).
 */
export function buildFullChatUrl(
  rawBaseUrl: string | undefined | null,
  format: ApiFormat,
): string {
  if (format === 'anthropic') {
    const base = normalizeBaseUrl(rawBaseUrl) || 'https://api.anthropic.com';
    return `${base}/v1/messages`;
  }
  return `${resolveOpenAIBaseUrl(rawBaseUrl)}/chat/completions`;
}
