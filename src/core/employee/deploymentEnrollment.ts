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

  await (opts.saveSecret ?? setSecret)(SECRET_KEYS.deployment(deploymentId), credential);
  return {
    deploymentId,
    employeeId,
    hireId,
    ledgerEndpoint,
    heartbeatEndpoint,
    ...(hasRelayBinding ? { relayBaseUrl, relayModel } : {}),
  };
}

export async function deleteDeploymentCredential(deploymentId: string): Promise<void> {
  await deleteSecret(SECRET_KEYS.deployment(deploymentId));
}
