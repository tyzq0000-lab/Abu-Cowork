import { describe, expect, it, vi } from 'vitest';
import type { EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';
import { resolvePlatformRelayExecution } from './platformRelay';

const credential = 'upr_dep_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH';

function deployment(over: Partial<EmployeeDeploymentRecord> = {}): EmployeeDeploymentRecord {
  return {
    packageId: 'pkg_platform',
    packageVersion: '1.0.0',
    employeeId: 'emp_a',
    hireId: 'hire_a',
    deploymentId: 'dep_11111111111111111111111111111111',
    ledgerEndpoint: 'http://127.0.0.1:3001/api/ledger',
    relayBaseUrl: 'http://127.0.0.1:3001/api/relay',
    relayModel: 'platform-model',
    agentName: 'platform-agent',
    workspacePath: null,
    conversationId: 'conv_a',
    configuredAt: 1,
    ...over,
  };
}

describe('platform relay execution binding', () => {
  it('returns null for a conversation without a platform deployment', async () => {
    await expect(resolvePlatformRelayExecution('conv_none', { deployments: {} })).resolves.toBeNull();
  });

  it('loads the exact deployment secret and returns an ephemeral provider', async () => {
    const readSecret = vi.fn().mockResolvedValue(credential);
    const result = await resolvePlatformRelayExecution('conv_a', {
      deployments: {
        dep_a: deployment(),
        dep_b: deployment({
          deploymentId: 'dep_22222222222222222222222222222222',
          employeeId: 'emp_b',
          hireId: 'hire_b',
          conversationId: 'conv_b',
        }),
      },
      readSecret,
    });

    expect(readSecret).toHaveBeenCalledWith('deployment:dep_11111111111111111111111111111111');
    expect(result).toMatchObject({
      modelId: 'platform-model',
      deployment: { employeeId: 'emp_a', hireId: 'hire_a' },
      provider: {
        id: 'uprow-relay:dep_11111111111111111111111111111111',
        source: 'employee',
        apiFormat: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:3001/api/relay',
        apiKey: credential,
      },
    });
  });

  it('fails closed without config or secret and never accepts a cross-origin relay', async () => {
    await expect(resolvePlatformRelayExecution('conv_a', {
      deployments: { dep_a: deployment({ relayBaseUrl: undefined, relayModel: undefined }) },
      readSecret: async () => credential,
    })).rejects.toThrow(/重新部署/);

    const crossOriginSecret = vi.fn().mockResolvedValue(credential);
    await expect(resolvePlatformRelayExecution('conv_a', {
      deployments: { dep_a: deployment({ relayBaseUrl: 'http://localhost:3002/api/relay' }) },
      readSecret: crossOriginSecret,
    })).rejects.toThrow(/重新部署/);
    expect(crossOriginSecret).not.toHaveBeenCalled();

    await expect(resolvePlatformRelayExecution('conv_a', {
      deployments: { dep_a: deployment() },
      readSecret: async () => null,
    })).rejects.toThrow(/凭据缺失|重新部署/);
  });

  it('rejects ambiguous conversation bindings instead of picking a tenant', async () => {
    await expect(resolvePlatformRelayExecution('conv_a', {
      deployments: {
        dep_a: deployment(),
        dep_b: deployment({ deploymentId: 'dep_22222222222222222222222222222222' }),
      },
      readSecret: async () => credential,
    })).rejects.toThrow(/多个平台部署/);
  });
});
