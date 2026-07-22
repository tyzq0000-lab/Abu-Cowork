import { create } from 'zustand';
import { hostname, platform } from '@tauri-apps/plugin-os';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getOrCreateClientId } from '@/core/employee/clientIdentity';
import {
  fetchPlatformAccount,
  fetchPlatformDevices,
  logoutPlatformAccount,
  pollDesktopLogin,
  resolvePlatformOrigin,
  revokePlatformDevice,
  startDesktopLoginRequest,
  PlatformAccountError,
  type PlatformAccountSession,
  type PlatformAccountUser,
  type PlatformDevice,
} from '@/core/account/platformAccount';
import { deleteSecret, getSecret, SECRET_KEYS, setSecret } from '@/utils/secretStore';

type PlatformAccountStatus = 'loading' | 'signed-out' | 'authorizing' | 'signed-in' | 'error';

interface PlatformAccountState {
  initialized: boolean;
  status: PlatformAccountStatus;
  user: PlatformAccountUser | null;
  session: PlatformAccountSession | null;
  devices: PlatformDevice[];
  error: string | null;
  initialize: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  revokeDevice: (sessionId: string) => Promise<void>;
}

let accessToken: string | null = null;
let initializePromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function clearLocalSession(): Promise<void> {
  accessToken = null;
  await deleteSecret(SECRET_KEYS.platformAccount).catch(() => undefined);
}

export const usePlatformAccountStore = create<PlatformAccountState>((set, get) => ({
  initialized: false,
  status: 'loading',
  user: null,
  session: null,
  devices: [],
  error: null,

  initialize: async () => {
    if (get().initialized && get().status !== 'error') return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      try {
        accessToken = await getSecret(SECRET_KEYS.platformAccount);
        if (!accessToken) {
          set({ initialized: true, status: 'signed-out', user: null, session: null, devices: [], error: null });
          return;
        }
        const origin = resolvePlatformOrigin();
        const account = await fetchPlatformAccount(origin, accessToken);
        const devices = await fetchPlatformDevices(origin, accessToken);
        set({ initialized: true, status: 'signed-in', ...account, devices, error: null });
      } catch (error) {
        if (error instanceof PlatformAccountError && error.status === 401) {
          await clearLocalSession();
          set({ initialized: true, status: 'signed-out', user: null, session: null, devices: [], error: errorMessage(error) });
        } else {
          set({ initialized: true, status: 'error', user: null, session: null, devices: [], error: errorMessage(error) });
        }
      } finally {
        initializePromise = null;
      }
    })();
    return initializePromise;
  },

  signIn: async () => {
    if (get().status === 'authorizing') return;
    set({ status: 'authorizing', error: null });
    try {
      const origin = resolvePlatformOrigin();
      const clientId = await getOrCreateClientId();
      const machineName = (await hostname())?.trim();
      const os = platform();
      const request = await startDesktopLoginRequest({
        origin,
        clientId,
        deviceName: machineName ? `${machineName} · 扶摇 ${os}` : `扶摇 ${os} · ${clientId.slice(0, 8)}`,
      });
      await openUrl(request.authorizationUrl);
      const result = await pollDesktopLogin(origin, request);
      accessToken = result.accessToken;
      await setSecret(SECRET_KEYS.platformAccount, result.accessToken);
      const account = await fetchPlatformAccount(origin, result.accessToken);
      const devices = await fetchPlatformDevices(origin, result.accessToken);
      set({ initialized: true, status: 'signed-in', ...account, devices, error: null });
    } catch (error) {
      set({ initialized: true, status: 'error', user: null, session: null, devices: [], error: errorMessage(error) });
    }
  },

  signOut: async () => {
    const token = accessToken ?? await getSecret(SECRET_KEYS.platformAccount).catch(() => null);
    if (token) {
      const origin = (() => { try { return resolvePlatformOrigin(); } catch { return null; } })();
      if (origin) await logoutPlatformAccount(origin, token);
    }
    await clearLocalSession();
    set({ initialized: true, status: 'signed-out', user: null, session: null, devices: [], error: null });
  },

  refreshDevices: async () => {
    if (!accessToken || get().status !== 'signed-in') return;
    try {
      const devices = await fetchPlatformDevices(resolvePlatformOrigin(), accessToken);
      set({ devices, error: null });
    } catch (error) {
      if (error instanceof PlatformAccountError && error.status === 401) {
        await clearLocalSession();
        set({ status: 'signed-out', user: null, session: null, devices: [], error: errorMessage(error) });
      } else {
        set({ error: errorMessage(error) });
      }
    }
  },

  revokeDevice: async (sessionId) => {
    if (!accessToken || get().status !== 'signed-in') return;
    try {
      const current = get().session?.id === sessionId;
      await revokePlatformDevice(resolvePlatformOrigin(), accessToken, sessionId);
      if (current) {
        await clearLocalSession();
        set({ status: 'signed-out', user: null, session: null, devices: [], error: null });
      } else {
        await get().refreshDevices();
      }
    } catch (error) {
      if (error instanceof PlatformAccountError && error.status === 401) {
        await clearLocalSession();
        set({ status: 'signed-out', user: null, session: null, devices: [], error: errorMessage(error) });
      } else {
        set({ error: errorMessage(error) });
      }
    }
  },
}));
