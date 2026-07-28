import type { EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import { deleteSecret, getSecret, SECRET_KEYS } from '@/utils/secretStore';
import { isEnrollmentUrlAllowed } from '@/core/deeplink/parser';
import { remove } from '@tauri-apps/plugin-fs';
import { agentRegistry } from '@/core/agent/registry';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { resolveEmployeePackageDir } from './packageIntegrity';

export const DEPLOYMENT_HEARTBEAT_INTERVAL_MS = 60 * 1000;

export type DeploymentHeartbeatResult =
  | { state: 'authorized'; hireStatus: string }
  | { state: 'inactive'; hireStatus: string }
  // reason 区分「平台明确说你被解雇了（401）」和「本地凭据不见了」。
  // 只有前者才允许删用户磁盘上的员工包 —— 后者可能只是钥匙串读不到，删了就是事故。
  | { state: 'revoked'; reason: 'unauthorized' | 'no-credential' }
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
  if (!credential) return { state: 'revoked', reason: 'no-credential' };

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
    return { state: 'revoked', reason: 'unauthorized' };
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

/**
 * 平台确认解除雇佣后，把员工包从本机清掉。
 *
 * 以前解除雇佣**没有任何本地清理**：心跳收到 401 只删了那把部署 token，
 * `~/.uprow/employees/<包>` 原封不动留着，下次 discoverAgents 照样扫进来 ——
 * 于是「明明没部署过/早就解雇了，员工还挂在列表里」。
 *
 * 只在 reason==='unauthorized'（平台亲口说的 401）时执行。网络不通是 'offline'，
 * 本地凭据读不到是 'no-credential'，两者都不删文件 —— 网络抖一下就把客户的员工包
 * 抹了，比留个残留严重得多。
 */
export async function purgeRevokedDeployment(
  deploymentKey: string,
  deployment: EmployeeDeploymentRecord,
  opts: { removeDir?: typeof remove } = {},
): Promise<boolean> {
  const agent = agentRegistry.getAgent(deployment.agentName);
  useEmployeeDeploymentStore.getState().forgetDeployment(deploymentKey, deployment.agentName);
  if (!agent || agent.source !== 'employee' || !agent.filePath) return false;
  try {
    await (opts.removeDir ?? remove)(resolveEmployeePackageDir(agent.filePath), { recursive: true });
    return true;
  } catch (error) {
    console.warn('[deployment] 解除雇佣后清理员工包失败:', deployment.agentName, error);
    return false;
  }
}

let started = false;

/** Idempotent app-lifetime worker. Only platform-bound deployments opt in. */
export function startDeploymentHeartbeat(): () => void {
  if (started) return () => {};
  started = true;
  const beat = async () => {
    const deployments = useEmployeeDeploymentStore.getState().deployments;
    const entries = Object.entries(deployments);
    const results = await heartbeatAllEmployeeDeployments(deployments);
    // 平台亲口确认解除雇佣 → 连本地员工包一起清掉，别让它继续挂在员工列表里。
    await Promise.all(entries.map(async ([key, deployment], index) => {
      const result = results[index];
      if (result?.state !== 'revoked' || result.reason !== 'unauthorized') return;
      const purged = await purgeRevokedDeployment(key, deployment);
      if (purged) void useDiscoveryStore.getState().refresh();
    }));
  };
  void beat();
  const interval = setInterval(() => void beat(), DEPLOYMENT_HEARTBEAT_INTERVAL_MS);
  return () => {
    started = false;
    clearInterval(interval);
  };
}
