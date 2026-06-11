/**
 * Deep-link URL parser — fuyao:// scheme.
 *
 * Contract (platform → desktop bridge for deploying hired digital employees):
 *   fuyao://install?type=employee|skill&url=<encoded package zip URL>&name=<display name>
 *
 * - `type`  : package kind. `employee` = WorkBuddy/CodeBuddy package
 *             (.codebuddy-plugin/plugin.json), `skill` = .askill archive (SKILL.md).
 * - `url`   : direct download URL of the zip archive. Must be https on an
 *             allowlisted host (http allowed only for localhost dev testing).
 * - `name`  : optional display name shown in the confirm dialog.
 *
 * Parsing is pure and side-effect free; the caller decides what to do with
 * a valid request (confirm dialog → download → install).
 */

export type DeepLinkPackageType = 'employee' | 'skill';

export interface DeepLinkInstallRequest {
  action: 'install';
  pkgType: DeepLinkPackageType;
  /** Validated package download URL (https, allowlisted host). */
  url: string;
  /** Optional display name for the confirm dialog. */
  name?: string;
}

export type DeepLinkParseError =
  | 'INVALID_URL'
  | 'WRONG_SCHEME'
  | 'UNKNOWN_ACTION'
  | 'INVALID_TYPE'
  | 'MISSING_URL'
  | 'URL_NOT_ALLOWED';

export type DeepLinkParseResult =
  | { ok: true; request: DeepLinkInstallRequest }
  | { ok: false; code: DeepLinkParseError; message: string };

/**
 * Hosts the desktop will download packages from. Extend when the uprow
 * platform download endpoint goes live. Exact hostname match, https only.
 */
export const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = [
  'abu-agent.oss-cn-beijing.aliyuncs.com',
];

/** Plain-http hosts allowed for local development / demo only. */
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Validate a package download URL against the allowlist. */
export function isDownloadUrlAllowed(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') {
    return ALLOWED_DOWNLOAD_HOSTS.includes(u.hostname);
  }
  if (u.protocol === 'http:') {
    return LOCAL_DEV_HOSTS.has(u.hostname);
  }
  return false;
}

/** Parse a raw deep-link URL string into a validated install request. */
export function parseDeepLink(raw: string): DeepLinkParseResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, code: 'INVALID_URL', message: `Not a URL: ${raw}` };
  }

  if (u.protocol !== 'fuyao:') {
    return { ok: false, code: 'WRONG_SCHEME', message: `Unsupported scheme: ${u.protocol}` };
  }

  // Action = host part of fuyao://<action>?...  (tolerate a trailing "/" path)
  const action = u.hostname;
  if (action !== 'install') {
    return { ok: false, code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` };
  }

  const pkgType = u.searchParams.get('type');
  if (pkgType !== 'employee' && pkgType !== 'skill') {
    return { ok: false, code: 'INVALID_TYPE', message: `Invalid package type: ${pkgType ?? '(missing)'}` };
  }

  const downloadUrl = u.searchParams.get('url');
  if (!downloadUrl) {
    return { ok: false, code: 'MISSING_URL', message: 'Missing "url" parameter' };
  }
  if (!isDownloadUrlAllowed(downloadUrl)) {
    return { ok: false, code: 'URL_NOT_ALLOWED', message: `Download host not allowlisted: ${downloadUrl}` };
  }

  const name = u.searchParams.get('name') ?? undefined;

  return {
    ok: true,
    request: { action: 'install', pkgType, url: downloadUrl, name },
  };
}
