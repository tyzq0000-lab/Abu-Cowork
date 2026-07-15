import type { EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import { deleteSecret, getSecret, SECRET_KEYS } from '@/utils/secretStore';
import { isEnrollmentUrlAllowed } from '@/core/deeplink/parser';

export const DEPLOYMENT_HEARTBEAT_INTERVAL_MS = 60 * 1000;

export type DeploymentHeartbeatResult =
  | { state: 'authorized'; hireStatus: string }
  | { state: 'inactive'; hireStatus: string }
  | { state: 'revoked' }
  | { state: 'offline' }
  | { state: 'skipped' };

function validHeartbeatBinding(deployment: EmployeeDeploymentRecord): boolean {
  if (!deployment.heartbeatEndpoint || !deployment.ledgerEndpoint) return false;
  try {
    const heartbeat = new URL(deployment.heartbeatEndpoint);
    const ledger = new URL(deployment.ledgerEndpoint);
    return heartbeat.origin === ledger.origin
      && heartbeat.pathname === '/api/deployments/heartbeat'
      && ledger.pathname === '/api/ledger'
      && !heartbeat.search
      && !heartbeat.hash
      && isEnrollmentUrlAllowed(deployment.heartbeatEndpoint)
      && isEnrollmentUrlAllowed(deployment.ledgerEndpoint);
  } catch {
    return false;
  }
}

export async function heartbeatEmployeeDeployment(
  deployment: EmployeeDeploymentRecord,
  opts: {
    fetchImpl?: typeof fetch;
    readSecret?: typeof getSecret;
    removeSecret?: typeof deleteSecret;
  } = {},
): Promise<DeploymentHeartbeatResult> {
  if (!deployment.deploymentId) return { state: 'skipped' };
  const endpoint = deployment.heartbeatEndpoint;
  if (!endpoint) return { state: 'offline' };
  if (!validHeartbeatBinding(deployment)) return { state: 'offline' };
  let credential: string | null;
  try {
    credential = await (opts.readSecret ?? getSecret)(SECRET_KEYS.deployment(deployment.deploymentId));
  } catch {
    return { state: 'offline' };
  }
  if (!credential) return { state: 'revoked' };

  let response: Response;
  try {
    response = await (opts.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}` },
    });
  } catch {
    return { state: 'offline' };
  }
  if (response.status === 401) {
    await (opts.removeSecret ?? deleteSecret)(SECRET_KEYS.deployment(deployment.deploymentId)).catch(() => undefined);
    return { state: 'revoked' };
  }
  if (!response.ok) return { state: 'offline' };

  try {
    const body = await response.json() as Record<string, unknown>;
    if (
      body.deploymentId !== deployment.deploymentId
      || body.employeeId !== deployment.employeeId
      || body.hireId !== deployment.hireId
      || typeof body.authorized !== 'boolean'
      || typeof body.hireStatus !== 'string'
    ) return { state: 'offline' };
    return body.authorized
      ? { state: 'authorized', hireStatus: body.hireStatus }
      : { state: 'inactive', hireStatus: body.hireStatus };
  } catch {
    return { state: 'offline' };
  }
}

export async function heartbeatAllEmployeeDeployments(
  deployments: Record<string, EmployeeDeploymentRecord>,
  opts: Parameters<typeof heartbeatEmployeeDeployment>[1] = {},
): Promise<DeploymentHeartbeatResult[]> {
  return Promise.all(Object.values(deployments).map((deployment) => heartbeatEmployeeDeployment(deployment, opts)));
}

let started = false;

/** Idempotent app-lifetime worker. Only platform-bound deployments opt in. */
export function startDeploymentHeartbeat(): () => void {
  if (started) return () => {};
  started = true;
  const beat = () => heartbeatAllEmployeeDeployments(useEmployeeDeploymentStore.getState().deployments);
  void beat();
  const interval = setInterval(() => void beat(), DEPLOYMENT_HEARTBEAT_INTERVAL_MS);
  return () => {
    started = false;
    clearInterval(interval);
  };
}
