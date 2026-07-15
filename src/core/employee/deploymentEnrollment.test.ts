import { describe, expect, it, vi } from 'vitest';
import { exchangeDeploymentEnrollment } from './deploymentEnrollment';

const input = {
  employeeId: 'emp_123',
  hireId: 'hire_123',
  enrollmentCode: 'upr_enr_abcdefghijklmnopqrstuvwxyz123456',
  enrollmentUrl: 'https://uprow.example.com/api/deployments/exchange',
};

function okBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deploymentId: 'dep_11111111111111111111111111111111',
    employeeId: 'emp_123',
    hireId: 'hire_123',
    credential: 'upr_dep_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH',
    ledgerEndpoint: 'https://uprow.example.com/api/ledger',
    heartbeatEndpoint: 'https://uprow.example.com/api/deployments/heartbeat',
    relayBaseUrl: 'https://uprow.example.com/api/relay',
    relayModel: 'platform-model',
    ...over,
  };
}

describe('deployment enrollment exchange', () => {
  it('sends the stable client id and stores only the bearer in the secret store', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(okBody()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const saveSecret = vi.fn().mockResolvedValue(undefined);
    const binding = await exchangeDeploymentEnrollment(input, {
      fetchImpl,
      getClientId: async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      saveSecret,
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({
      enrollmentCode: input.enrollmentCode,
      clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(saveSecret).toHaveBeenCalledWith(
      'deployment:dep_11111111111111111111111111111111',
      okBody().credential,
    );
    expect(binding).toEqual({
      deploymentId: 'dep_11111111111111111111111111111111',
      employeeId: 'emp_123',
      hireId: 'hire_123',
      ledgerEndpoint: 'https://uprow.example.com/api/ledger',
      heartbeatEndpoint: 'https://uprow.example.com/api/deployments/heartbeat',
      relayBaseUrl: 'https://uprow.example.com/api/relay',
      relayModel: 'platform-model',
    });
    expect(JSON.stringify(binding)).not.toContain('upr_dep_');
  });

  it('fails closed on employee mismatch or cross-origin platform endpoints', async () => {
    const saveSecret = vi.fn();
    for (const body of [
      okBody({ employeeId: 'emp_other' }),
      okBody({ ledgerEndpoint: 'https://evil.example.com/api/ledger' }),
      okBody({ heartbeatEndpoint: 'https://evil.example.com/api/deployments/heartbeat' }),
      okBody({ relayBaseUrl: 'https://evil.example.com/api/relay' }),
      okBody({ relayModel: '' }),
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
      await expect(exchangeDeploymentEnrollment(input, {
        fetchImpl,
        getClientId: async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        saveSecret,
      })).rejects.toThrow(/不完整|不匹配/);
    }
    expect(saveSecret).not.toHaveBeenCalled();
  });

  it('surfaces platform rejection and never stores a credential', async () => {
    const saveSecret = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: '部署交换码已过期，请重新发起部署' }),
      { status: 410 },
    ));
    await expect(exchangeDeploymentEnrollment(input, {
      fetchImpl,
      getClientId: async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      saveSecret,
    })).rejects.toThrow(/已过期/);
    expect(saveSecret).not.toHaveBeenCalled();
  });
});
