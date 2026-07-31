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
    // reason 必须是 unauthorized —— 只有这一态才允许后续删用户磁盘上的员工包。
    })).resolves.toEqual({ state: 'revoked', reason: 'unauthorized' });
    expect(removeSecret).toHaveBeenCalledWith('deployment:dep_11111111111111111111111111111111');
  });

  it('平台管理员解除雇佣走 200 + authorized:false + terminated，等同 401', async () => {
    // 企业解除 → 凭据被置空 → 401；但平台管理员从 admin 端解除时凭据仍然有效，
    // 心跳拿到的是 200 + entitlementReason:'terminated'。只认 401 的话员工永远挂在侧边栏。
    const removeSecret = vi.fn().mockResolvedValue(undefined);
    await expect(heartbeatEmployeeDeployment(deployment(), {
      readSecret: async () => 'upr_dep_test-secret',
      fetchImpl: async () => heartbeatResponse({
        authorized: false, hireStatus: '已解除', entitlementReason: 'terminated',
      }),
      removeSecret,
    })).resolves.toEqual({ state: 'revoked', reason: 'unauthorized' });
    expect(removeSecret).toHaveBeenCalledWith('deployment:dep_11111111111111111111111111111111');
  });

  it('可恢复的停用理由只算 inactive，绝不删员工包', async () => {
    // paused / payment_required / employee_unavailable 都可能恢复；未知理由一律按非终态。
    const removeSecret = vi.fn().mockResolvedValue(undefined);
    for (const [entitlementReason, hireStatus] of [
      ['paused', '已暂停'],
      ['payment_required', '在岗'],
      ['employee_unavailable', '在岗'],
      ['awaiting_deployment', '待部署'],
      ['some_future_reason', '在岗'],
    ]) {
      await expect(heartbeatEmployeeDeployment(deployment(), {
        readSecret: async () => 'upr_dep_test-secret',
        fetchImpl: async () => heartbeatResponse({ authorized: false, hireStatus, entitlementReason }),
        removeSecret,
      })).resolves.toEqual({ state: 'inactive', hireStatus });
    }
    expect(removeSecret).not.toHaveBeenCalled();
  });

  it('本地凭据缺失只算 no-credential，绝不当成平台解雇', async () => {
    // 钥匙串读不到 ≠ 企业解除了雇佣。若这一态也标成 unauthorized，
    // 清理逻辑会把用户还在用的员工包删掉。
    await expect(heartbeatEmployeeDeployment(deployment(), {
      readSecret: async () => null,
      fetchImpl: async () => { throw new Error('should not be called'); },
    })).resolves.toEqual({ state: 'revoked', reason: 'no-credential' });
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
