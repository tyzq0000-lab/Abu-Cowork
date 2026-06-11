import { create } from 'zustand';
import type { DeepLinkInstallRequest } from '@/core/deeplink/parser';

/**
 * Deep-link install flow state — purely ephemeral by design (no persist):
 * a pending request only makes sense while the app instance that received
 * the fuyao:// URL is alive. The confirm dialog renders off `pending`;
 * `installing` guards against double-confirm while a download is running.
 */
interface DeepLinkState {
  pending: DeepLinkInstallRequest | null;
  installing: boolean;
}

interface DeepLinkActions {
  setPending: (req: DeepLinkInstallRequest) => void;
  clearPending: () => void;
  setInstalling: (installing: boolean) => void;
}

export type DeepLinkStore = DeepLinkState & DeepLinkActions;

export const useDeepLinkStore = create<DeepLinkStore>()((set) => ({
  pending: null,
  installing: false,

  setPending: (req) => set({ pending: req }),
  clearPending: () => set({ pending: null }),
  setInstalling: (installing) => set({ installing }),
}));
