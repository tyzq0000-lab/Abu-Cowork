import { getOrCreateClientId } from './clientIdentity';
import { SECRET_KEYS, deleteSecret, setSecret } from '@/utils/secretStore';

export interface DeploymentEnrollmentInput {
  employeeId: string;
  hireId: string;
  enrollmentCode: string;
  enrollmentUrl: string;
}

export interface EmployeePlatformBinding {
  deploymentId: string;
  employeeId: string;
  hireId: string;
  ledgerEndpoint: string;
  heartbeatEndpoint: string;
  relayBaseUrl?: string;
  relayModel?: string;
  /**
   * Identity as minted on the platform. Overrides whatever the package manifest
   * declares, so the employee shows up here under the same name/face the
   * enterprise hired on the platform. All three are optional: a package
   * installed outside the platform has none of them and keeps its own identity.
   */
  displayName?: string;
  profession?: string;
  avatar?: string;
}

export class DeploymentEnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentEnrollmentError';
  }
}

function validPlatformEndpoint(raw: string, enrollmentUrl: string, pathname: string): boolean {
  try {
    const endpoint = new URL(raw);
    const enrollment = new URL(enrollmentUrl);
    return endpoint.origin === enrollment.origin
      && endpoint.pathname === pathname
      && !endpoint.username
      && !endpoint.password
      && !endpoint.search
      && !endpoint.hash;
  } catch {
    return false;
  }
}

/**
 * Platform-minted identity is cosmetic, so it **degrades instead of failing**:
 * anything malformed is dropped and the package's own name/face is used. Failing
 * a working deployment over a bad avatar would be the wrong trade.
 *
 * The avatar ends up in an `<img src>`, so the scheme is whitelisted — `data:`
 * restricted to image types, or `https:`. Without this, a compromised or
 * misconfigured platform response could hand us `javascript:` or
 * `data:text/html`. The size cap exists because this string is persisted by a
 * zustand `persist` store: an oversized avatar would eat the storage quota and
 * take unrelated deployment records down with it.
 */
const MAX_DISPLAY_NAME = 60;
const MAX_PROFESSION = 80;
const MAX_AVATAR_CHARS = 256 * 1024;

function cleanIdentityText(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // Strip control characters so a crafted name can't garble the sidebar layout.
  // Iterated by code point (not `split('')`) so emoji and other astral
  // characters in a name survive intact instead of being torn into surrogates.
  const text = [...raw]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  return text && text.length <= maxLength ? text : undefined;
}

function cleanAvatar(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value || value.length > MAX_AVATAR_CHARS) return undefined;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Consume a short-lived enrollment code, then place the long-lived bearer in
 * the OS secret store. The returned/persisted binding contains no credential.
 */
export async function exchangeDeploymentEnrollment(
  input: DeploymentEnrollmentInput,
  opts: {
    fetchImpl?: typeof fetch;
    getClientId?: () => Promise<string>;
    saveSecret?: (key: string, value: string) => Promise<void>;
  } = {},
): Promise<EmployeePlatformBinding> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const clientId = await (opts.getClientId ?? getOrCreateClientId)();
  let response: Response;
  try {
    response = await fetchImpl(input.enrollmentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentCode: input.enrollmentCode, clientId }),
    });
  } catch {
    throw new DeploymentEnrollmentError('无法连接有谱平台，请检查网络后从平台重新发起部署。');
  }

  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    // A non-JSON response is handled by the same fail-closed validation below.
  }
  if (!response.ok) {
    const serverMessage = typeof body.error === 'string' ? body.error : '';
    throw new DeploymentEnrollmentError(serverMessage || `部署身份交换失败（HTTP ${response.status}）`);
  }

  const deploymentId = String(body.deploymentId ?? '').trim();
  const employeeId = String(body.employeeId ?? '').trim();
  const hireId = String(body.hireId ?? '').trim();
  const credential = String(body.credential ?? '').trim();
  const ledgerEndpoint = String(body.ledgerEndpoint ?? '').trim();
  const heartbeatEndpoint = String(body.heartbeatEndpoint ?? '').trim();
  const relayBaseUrl = String(body.relayBaseUrl ?? '').trim();
  const relayModel = String(body.relayModel ?? '').trim();
  const hasRelayBinding = !!relayBaseUrl || !!relayModel;
  if (
    !/^dep_[0-9a-f]{32}$/i.test(deploymentId)
    || employeeId !== input.employeeId
    || hireId !== input.hireId
    || !/^upr_dep_[A-Za-z0-9_-]{40,100}$/.test(credential)
    || !validPlatformEndpoint(ledgerEndpoint, input.enrollmentUrl, '/api/ledger')
    || !validPlatformEndpoint(heartbeatEndpoint, input.enrollmentUrl, '/api/deployments/heartbeat')
    || (hasRelayBinding && (
      !relayBaseUrl
      || !relayModel
      || relayModel.length > 120
      || !validPlatformEndpoint(relayBaseUrl, input.enrollmentUrl, '/api/relay')
    ))
  ) {
    throw new DeploymentEnrollmentError('平台返回的部署身份不完整或与员工不匹配。');
  }

  const displayName = cleanIdentityText(body.displayName, MAX_DISPLAY_NAME);
  const profession = cleanIdentityText(body.profession, MAX_PROFESSION);
  const avatar = cleanAvatar(body.avatar);

  await (opts.saveSecret ?? setSecret)(SECRET_KEYS.deployment(deploymentId), credential);
  return {
    deploymentId,
    employeeId,
    hireId,
    ledgerEndpoint,
    heartbeatEndpoint,
    ...(hasRelayBinding ? { relayBaseUrl, relayModel } : {}),
    ...(displayName ? { displayName } : {}),
    ...(profession ? { profession } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

export async function deleteDeploymentCredential(deploymentId: string): Promise<void> {
  await deleteSecret(SECRET_KEYS.deployment(deploymentId));
}
