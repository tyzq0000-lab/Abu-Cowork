import type { ProviderInstance } from '@/types/provider';
import { isEnrollmentUrlAllowed } from '@/core/deeplink/parser';
import {
  useEmployeeDeploymentStore,
  type EmployeeDeploymentRecord,
} from '@/stores/employeeDeploymentStore';
import { getSecret, SECRET_KEYS } from '@/utils/secretStore';

export interface PlatformRelayExecution {
  modelId: string;
  provider: ProviderInstance;
  deployment: EmployeeDeploymentRecord;
}

export class PlatformRelayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformRelayUnavailableError';
  }
}

function validStoredRelayBinding(deployment: EmployeeDeploymentRecord): boolean {
  if (!deployment.relayBaseUrl || !deployment.relayModel || !deployment.ledgerEndpoint) return false;
  try {
    const relay = new URL(deployment.relayBaseUrl);
    const ledger = new URL(deployment.ledgerEndpoint);
    return relay.origin === ledger.origin
      && relay.pathname === '/api/relay'
      && ledger.pathname === '/api/ledger'
      && !relay.search
      && !relay.hash
      && !ledger.search
      && !ledger.hash
      && deployment.relayModel.trim().length > 0
      && deployment.relayModel.length <= 120
      && isEnrollmentUrlAllowed(deployment.relayBaseUrl)
      && isEnrollmentUrlAllowed(deployment.ledgerEndpoint);
  } catch {
    return false;
  }
}

/** Resolve an exact conversation-to-deployment binding. Bound conversations never fall back. */
export async function resolvePlatformRelayExecution(
  conversationId: string,
  opts: {
    deployments?: Record<string, EmployeeDeploymentRecord>;
    readSecret?: (key: string) => Promise<string | null>;
    /** Employee selected by routing. Enables new conversations and @delegation
     *  to reuse exactly one platform deployment without weakening tenant isolation. */
    agentName?: string;
  } = {},
): Promise<PlatformRelayExecution | null> {
  const deployments = opts.deployments ?? useEmployeeDeploymentStore.getState().deployments;
  const exactMatches = Object.values(deployments).filter(
    (deployment) => deployment.conversationId === conversationId && !!deployment.deploymentId,
  );
  const matches = exactMatches.length > 0
    ? exactMatches
    : opts.agentName
      ? Object.values(deployments).filter(
          (deployment) => deployment.agentName === opts.agentName && !!deployment.deploymentId,
        )
      : [];
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new PlatformRelayUnavailableError('该员工匹配了多个平台部署，已停止执行以防企业身份串用。请撤销旧设备后重新部署。');
  }

  const deployment = matches[0];
  if (opts.agentName && deployment.agentName !== opts.agentName) {
    throw new PlatformRelayUnavailableError('当前对话与平台员工身份不一致，已停止执行以防账本串用。请从有谱平台重新部署。');
  }
  if (!deployment.employeeId || !deployment.hireId || !validStoredRelayBinding(deployment)) {
    throw new PlatformRelayUnavailableError('该平台员工尚未获得可用的模型中继配置，请从有谱平台重新部署。');
  }

  const credential = await (opts.readSecret ?? getSecret)(SECRET_KEYS.deployment(deployment.deploymentId!));
  if (!credential || !/^upr_dep_[A-Za-z0-9_-]{40,100}$/.test(credential)) {
    throw new PlatformRelayUnavailableError('该员工的部署凭据缺失或已失效，请从有谱平台重新部署。');
  }

  const modelId = deployment.relayModel!.trim();
  return {
    modelId,
    deployment,
    provider: {
      id: `uprow-relay:${deployment.deploymentId}`,
      source: 'employee',
      name: '有谱平台模型中继',
      enabled: true,
      apiFormat: 'openai-compatible',
      baseUrl: deployment.relayBaseUrl!,
      apiKey: credential,
      models: [{ id: modelId, label: modelId }],
      defaultModelId: modelId,
      status: 'verified',
      sortOrder: 0,
    },
  };
}
