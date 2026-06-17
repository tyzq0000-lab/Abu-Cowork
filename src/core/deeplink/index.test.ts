import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeepLinkStore } from '@/stores/deepLinkStore';

const onOpenUrl = vi.fn();
const getCurrent = vi.fn();
const invoke = vi.fn();

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl,
  getCurrent,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}));

describe('initDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDeepLinkStore.getState().clearPending();
    onOpenUrl.mockResolvedValue(vi.fn());
    getCurrent.mockResolvedValue(null);
    invoke.mockResolvedValue(undefined);
  });

  it('stages the URL that cold-started the desktop app', async () => {
    getCurrent.mockResolvedValue([
      'fuyao://install?type=employee&url=http%3A%2F%2F127.0.0.1%3A3102%2Fpackage.zip&packageId=inventory-clerk',
    ]);

    const { initDeepLink } = await import('./index');
    await initDeepLink();

    expect(useDeepLinkStore.getState().pending).toMatchObject({
      pkgType: 'employee',
      packageId: 'inventory-clerk',
      url: 'http://127.0.0.1:3102/package.zip',
    });
  });

  it('recovers a warm-start URL queued before the webview listener was ready', async () => {
    invoke.mockImplementation(async (command: string) => (
      command === 'take_pending_deep_links'
        ? ['fuyao://install?type=employee&url=http%3A%2F%2F127.0.0.1%3A3102%2Fpayroll.zip&packageId=payroll-clerk']
        : undefined
    ));

    const { initDeepLink } = await import('./index');
    await initDeepLink();

    expect(useDeepLinkStore.getState().pending).toMatchObject({
      pkgType: 'employee',
      packageId: 'payroll-clerk',
    });
  });
});
