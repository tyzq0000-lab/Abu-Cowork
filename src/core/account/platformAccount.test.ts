import { describe, expect, it, vi } from 'vitest';
import {
  fetchPlatformAccount,
  fetchPlatformDevices,
  pollDesktopLogin,
  revokePlatformDevice,
  startDesktopLoginRequest,
} from './platformAccount';

const origin = 'https://www.trustworkai.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('platform desktop account client', () => {
  it('starts a PKCE request and accepts only a same-origin authorization URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      requestId: 'upr_login_abcdefghijklmnopqrstuvwxyz123456',
      authorizationUrl: `${origin}/?view=desktop-auth&request=upr_login_abcdefghijklmnopqrstuvwxyz123456`,
      expiresAt: Date.now() + 60_000,
      intervalMs: 10,
    }, 201));

    const request = await startDesktopLoginRequest({
      origin,
      clientId: '123e4567-e89b-42d3-a456-426614174000',
      deviceName: 'Office PC',
      fetchImpl,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.codeVerifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(request.intervalMs).toBe(1000);

    fetchImpl.mockResolvedValueOnce(jsonResponse({
      requestId: 'upr_login_abcdefghijklmnopqrstuvwxyz123456',
      authorizationUrl: 'https://evil.example/?request=upr_login_abcdefghijklmnopqrstuvwxyz123456',
      expiresAt: Date.now() + 60_000,
    }, 201));
    await expect(startDesktopLoginRequest({
      origin,
      clientId: '123e4567-e89b-42d3-a456-426614174000',
      deviceName: 'Office PC',
      fetchImpl,
    })).rejects.toThrow(/无效的登录授权地址/);
  });

  it('polls pending requests and exchanges the verifier exactly once', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'pending' }, 202))
      .mockResolvedValueOnce(jsonResponse({
        accessToken: 'upr_user_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ',
        expiresAt: Date.now() + 60_000,
        sessionId: 'ds_abcdefghijklmnopqrstuvwxyz',
        user: { id: 'user_1', phone: '13800138000', name: '测试企业', role: 'enterprise' },
      }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await pollDesktopLogin(origin, {
      requestId: 'upr_login_abcdefghijklmnopqrstuvwxyz123456',
      codeVerifier: 'a'.repeat(64),
      authorizationUrl: `${origin}/?view=desktop-auth`,
      expiresAt: Date.now() + 60_000,
      intervalMs: 1000,
    }, { fetchImpl, sleep });

    expect(result.user.phone).toBe('13800138000');
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      requestId: 'upr_login_abcdefghijklmnopqrstuvwxyz123456',
      codeVerifier: 'a'.repeat(64),
    });
  });

  it('uses the desktop bearer for account and device operations', async () => {
    const token = 'upr_user_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ';
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        user: { id: 'user_1', phone: '13800138000', name: null, role: 'personal' },
        session: { id: 'ds_current', clientId: 'client_1', deviceName: 'Office PC', expiresAt: 10 },
      }))
      .mockResolvedValueOnce(jsonResponse({ devices: [{
        id: 'ds_current', deviceName: 'Office PC', createdAt: 1, lastSeenAt: 2, expiresAt: 10, current: true,
      }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(fetchPlatformAccount(origin, token, fetchImpl)).resolves.toMatchObject({ user: { id: 'user_1' } });
    await expect(fetchPlatformDevices(origin, token, fetchImpl)).resolves.toHaveLength(1);
    await expect(revokePlatformDevice(origin, token, 'ds_current', fetchImpl)).resolves.toBeUndefined();
    for (const call of fetchImpl.mock.calls) {
      expect(call[1]?.headers).toEqual({ Authorization: `Bearer ${token}` });
    }
  });
});
