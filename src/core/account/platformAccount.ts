import { isEnrollmentUrlAllowed } from '@/core/deeplink/parser';

export interface PlatformAccountUser {
  id: string;
  phone: string;
  name: string | null;
  role: string;
}

export interface PlatformAccountSession {
  id: string;
  clientId: string;
  deviceName: string;
  expiresAt: number;
}

export interface PlatformDevice {
  id: string;
  deviceName: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

export interface DesktopLoginRequest {
  requestId: string;
  codeVerifier: string;
  authorizationUrl: string;
  expiresAt: number;
  intervalMs: number;
}

export interface DesktopLoginResult {
  accessToken: string;
  expiresAt: number;
  sessionId: string;
  user: PlatformAccountUser;
}

export class PlatformAccountError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'PlatformAccountError';
    this.status = status;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function firstPlatformHost(): string {
  return String(import.meta.env.VITE_UPROW_PLATFORM_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .find(Boolean) ?? '';
}

export function resolvePlatformOrigin(): string {
  const configured = String(import.meta.env.VITE_UPROW_PLATFORM_URL ?? '').trim();
  const candidate = configured
    || (firstPlatformHost() ? `https://${firstPlatformHost()}` : '')
    || (import.meta.env.DEV ? 'http://127.0.0.1:3001' : '');
  if (!candidate) throw new PlatformAccountError('当前安装包未配置有谱平台地址，请更新扶摇后重试');
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new PlatformAccountError('有谱平台地址配置无效，请更新扶摇后重试');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new PlatformAccountError('有谱平台地址配置无效，请更新扶摇后重试');
  }
  if (!isEnrollmentUrlAllowed(`${url.origin}/api/deployments/heartbeat`)) {
    throw new PlatformAccountError('有谱平台地址未通过官方域名校验，请更新扶摇后重试');
  }
  return url.origin;
}

async function jsonRequest<T>(
  origin: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ response: Response; data: T & { error?: string } }> {
  const response = await fetchImpl(`${origin}${path}`, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  return { response, data };
}

export async function startDesktopLoginRequest(input: {
  origin: string;
  clientId: string;
  deviceName: string;
  fetchImpl?: typeof fetch;
}): Promise<DesktopLoginRequest> {
  const { verifier, challenge } = await createPkce();
  const { response, data } = await jsonRequest<{
    requestId?: string;
    authorizationUrl?: string;
    expiresAt?: number;
    intervalMs?: number;
  }>(input.origin, '/api/desktop-auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: input.clientId,
      deviceName: input.deviceName,
      codeChallenge: challenge,
    }),
  }, input.fetchImpl ?? fetch);
  if (!response.ok
    || typeof data.requestId !== 'string'
    || typeof data.authorizationUrl !== 'string'
    || typeof data.expiresAt !== 'number') {
    throw new PlatformAccountError(data.error ?? '无法发起有谱登录，请稍后重试', response.status);
  }
  const authorizationUrl = new URL(data.authorizationUrl);
  if (authorizationUrl.origin !== input.origin || authorizationUrl.searchParams.get('request') !== data.requestId) {
    throw new PlatformAccountError('平台返回了无效的登录授权地址');
  }
  return {
    requestId: data.requestId,
    codeVerifier: verifier,
    authorizationUrl: authorizationUrl.toString(),
    expiresAt: data.expiresAt,
    intervalMs: Math.min(5000, Math.max(1000, data.intervalMs ?? 2000)),
  };
}

export async function pollDesktopLogin(
  origin: string,
  request: DesktopLoginRequest,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<DesktopLoginResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  while (Date.now() < request.expiresAt) {
    if (options.signal?.aborted) throw new PlatformAccountError('登录已取消');
    const { response, data } = await jsonRequest<Partial<DesktopLoginResult>>(
      origin,
      '/api/desktop-auth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.requestId, codeVerifier: request.codeVerifier }),
        signal: options.signal,
      },
      fetchImpl,
    );
    if (response.status === 202) {
      await sleep(request.intervalMs);
      continue;
    }
    if (!response.ok
      || typeof data.accessToken !== 'string'
      || typeof data.expiresAt !== 'number'
      || typeof data.sessionId !== 'string'
      || !data.user
      || typeof data.user.id !== 'string'
      || typeof data.user.phone !== 'string') {
      throw new PlatformAccountError(data.error ?? '有谱登录失败，请重新发起', response.status);
    }
    return data as DesktopLoginResult;
  }
  throw new PlatformAccountError('登录请求已过期，请重新发起', 410);
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchPlatformAccount(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ user: PlatformAccountUser; session: PlatformAccountSession }> {
  const { response, data } = await jsonRequest<{
    user?: PlatformAccountUser;
    session?: PlatformAccountSession;
  }>(origin, '/api/desktop-auth/me', { headers: bearer(token) }, fetchImpl);
  if (!response.ok || !data.user || !data.session) {
    throw new PlatformAccountError(data.error ?? '桌面登录已过期', response.status);
  }
  return { user: data.user, session: data.session };
}

export async function fetchPlatformDevices(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformDevice[]> {
  const { response, data } = await jsonRequest<{ devices?: PlatformDevice[] }>(
    origin,
    '/api/desktop-auth/devices',
    { headers: bearer(token) },
    fetchImpl,
  );
  if (!response.ok || !Array.isArray(data.devices)) {
    throw new PlatformAccountError(data.error ?? '无法读取登录设备', response.status);
  }
  return data.devices;
}

export async function revokePlatformDevice(
  origin: string,
  token: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { response, data } = await jsonRequest<Record<string, never>>(
    origin,
    `/api/desktop-auth/devices/${encodeURIComponent(sessionId)}/revoke`,
    { method: 'POST', headers: bearer(token) },
    fetchImpl,
  );
  if (!response.ok) throw new PlatformAccountError(data.error ?? '设备撤销失败', response.status);
}

export async function logoutPlatformAccount(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await jsonRequest<Record<string, never>>(origin, '/api/desktop-auth/logout', {
    method: 'POST',
    headers: bearer(token),
  }, fetchImpl).catch(() => undefined);
}
