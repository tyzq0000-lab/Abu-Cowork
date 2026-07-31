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

describe('platform-minted identity in the exchange response', () => {
  async function bindingFor(over: Record<string, unknown>) {
    return exchangeDeploymentEnrollment(input, {
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(okBody(over)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
      getClientId: async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      saveSecret: vi.fn().mockResolvedValue(undefined),
    });
  }

  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('carries name, profession and a data-url avatar through to the binding', async () => {
    const binding = await bindingFor({
      displayName: '小野同学',
      profession: '新媒体增长运营数字人',
      avatar: tinyPng,
    });
    expect(binding.displayName).toBe('小野同学');
    expect(binding.profession).toBe('新媒体增长运营数字人');
    expect(binding.avatar).toBe(tinyPng);
  });

  it('degrades to no identity rather than failing the whole deployment', async () => {
    // A package installed outside the platform gets none of these fields; the
    // deployment must still succeed and keep the package's own identity.
    const binding = await bindingFor({});
    expect(binding.deploymentId).toBe('dep_11111111111111111111111111111111');
    expect(binding.displayName).toBeUndefined();
    expect(binding.profession).toBeUndefined();
    expect(binding.avatar).toBeUndefined();
  });

  it('rejects avatar values that are not renderable images', async () => {
    // The avatar lands in an <img src>. Anything outside data:image/* and https:
    // is dropped rather than rendered.
    for (const avatar of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'http://uprow.example.com/a.png',
      'file:///etc/passwd',
    ]) {
      expect((await bindingFor({ avatar })).avatar).toBeUndefined();
    }
    expect((await bindingFor({ avatar: 'https://cdn.example.com/a.png' })).avatar)
      .toBe('https://cdn.example.com/a.png');
  });

  it('drops an oversized avatar so it cannot blow the persisted store quota', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(256 * 1024)}`;
    expect((await bindingFor({ avatar: huge })).avatar).toBeUndefined();
  });

  it('strips control characters and drops over-long names', async () => {
    const bell = String.fromCharCode(7);
    expect((await bindingFor({ displayName: `小野${bell}同学` })).displayName)
      .toBe('小野同学');
    // Emoji must survive - iterating by code point, not by UTF-16 unit.
    expect((await bindingFor({ displayName: '小野🚀' })).displayName).toBe('小野🚀');
    expect((await bindingFor({ displayName: 'x'.repeat(61) })).displayName).toBeUndefined();
    expect((await bindingFor({ profession: 'y'.repeat(81) })).profession).toBeUndefined();
    expect((await bindingFor({ displayName: 42 })).displayName).toBeUndefined();
  });
});
