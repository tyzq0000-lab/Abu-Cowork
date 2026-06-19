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
  /** Platform employee record that initiated this deployment. */
  employeeId?: string;
  /** Platform package identifier. */
  packageId?: string;
  /** Requested package version. */
  packageVersion?: string;
  /** Generic post-install destination. */
  launchTarget?: 'conversation' | 'employee';
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
const configuredDownloadHosts = String(import.meta.env.VITE_FUYAO_PACKAGE_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

export const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = Array.from(new Set([
  'abu-agent.oss-cn-beijing.aliyuncs.com',
  ...configuredDownloadHosts,
]));

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
    // http allowed for localhost dev, and for explicitly-configured self-hosted
    // platform hosts (VITE_FUYAO_PACKAGE_HOSTS) — e.g. an on-prem uprow server on
    // plain http. Opt-in by build env only; never a wildcard.
    return LOCAL_DEV_HOSTS.has(u.hostname) || configuredDownloadHosts.includes(u.hostname);
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

  const optionalParam = (key: string): string | undefined => {
    const value = u.searchParams.get(key)?.trim();
    return value || undefined;
  };
  const name = optionalParam('name');
  const employeeId = optionalParam('employeeId');
  const packageId = optionalParam('packageId');
  const packageVersion = optionalParam('packageVersion');
  const rawLaunchTarget = optionalParam('launchTarget');
  const launchTarget =
    rawLaunchTarget === 'conversation' || rawLaunchTarget === 'employee'
      ? rawLaunchTarget
      : undefined;

  return {
    ok: true,
    request: {
      action: 'install',
      pkgType,
      url: downloadUrl,
      ...(name ? { name } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...(packageId ? { packageId } : {}),
      ...(packageVersion ? { packageVersion } : {}),
      ...(launchTarget ? { launchTarget } : {}),
    },
  };
}
