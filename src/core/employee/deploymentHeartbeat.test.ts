import { describe, expect, it, vi } from 'vitest';
import type { EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';
import { heartbeatEmployeeDeployment } from './deploymentHeartbeat';

function deployment(over: Partial<EmployeeDeploymentRecord> = {}): EmployeeDeploymentRecord {
  return {
    packageId: 'pkg_heartbeat',
    employeeId: 'emp_heartbeat',
    hireId: 'hire_heartbeat',
    deploymentId: 'dep_11111111111111111111111111111111',
    ledgerEndpoint: 'http://127.0.0.1:3001/api/ledger',
    heartbeatEndpoint: 'http://127.0.0.1:3001/api/deployments/heartbeat',
    agentName: 'heartbeat-agent',
    workspacePath: null,
    conversationId: 'conv_heartbeat',
    configuredAt: 1,
    ...over,
  };
}

function heartbeatResponse(over: Record<string, unknown> = {}, status = 200): Response {
  return new Response(JSON.stringify({
    deploymentId: 'dep_11111111111111111111111111111111',
    employeeId: 'emp_heartbeat',
    hireId: 'hire_heartbeat',
    authorized: true,
    hireStatus: '在岗',
    ...over,
  }), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('deployment authorization heartbeat', () => {
  it('reports authorized and inactive employment without exposing the bearer', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(heartbeatResponse())
      .mockResolvedValueOnce(heartbeatResponse({ authorized: false, hireStatus: '已暂停' }));
    const opts = { fetchImpl, readSecret: async () => 'upr_dep_test-secret' };

    await expect(heartbeatEmployeeDeployment(deployment(), opts)).resolves.toEqual({
      state: 'authorized', hireStatus: '在岗',
    });
    await expect(heartbeatEmployeeDeployment(deployment(), opts)).resolves.toEqual({
      state: 'inactive', hireStatus: '已暂停',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/deployments/heartbeat',
      { method: 'POST', headers: { Authorization: 'Bearer upr_dep_test-secret' } },
    );
  });

  it('deletes a permanently rejected credential and does not retry it as authorized', async () => {
    const removeSecret = vi.fn().mockResolvedValue(undefined);
    await expect(heartbeatEmployeeDeployment(deployment(), {
      readSecret: async () => 'upr_dep_test-secret',
      fetchImpl: async () => heartbeatResponse({ error: 'revoked' }, 401),
      removeSecret,
    })).resolves.toEqual({ state: 'revoked' });
    expect(removeSecret).toHaveBeenCalledWith('deployment:dep_11111111111111111111111111111111');
  });

  it('treats network, malformed identity, and tampered endpoints as offline', async () => {
    await expect(heartbeatEmployeeDeployment(deployment(), {
      readSecret: async () => 'upr_dep_test-secret',
      fetchImpl: async () => { throw new Error('offline'); },
    })).resolves.toEqual({ state: 'offline' });
    await expect(heartbeatEmployeeDeployment(deployment(), {
      readSecret: async () => 'upr_dep_test-secret',
      fetchImpl: async () => heartbeatResponse({ employeeId: 'emp_other' }),
    })).resolves.toEqual({ state: 'offline' });

    const readSecret = vi.fn().mockResolvedValue('upr_dep_test-secret');
    await expect(heartbeatEmployeeDeployment(deployment({
      heartbeatEndpoint: 'http://localhost:3002/api/deployments/heartbeat',
    }), { readSecret })).resolves.toEqual({ state: 'offline' });
    expect(readSecret).not.toHaveBeenCalled();
  });

  it('skips manual installs that have no platform deployment id', async () => {
    const readSecret = vi.fn();
    await expect(heartbeatEmployeeDeployment(deployment({ deploymentId: undefined }), { readSecret }))
      .resolves.toEqual({ state: 'skipped' });
    expect(readSecret).not.toHaveBeenCalled();
  });
});
