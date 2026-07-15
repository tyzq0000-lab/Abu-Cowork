import { create } from 'zustand';
import type { DeepLinkInstallRequest } from '@/core/deeplink/parser';
import type {
  EmployeeMaturityLevel,
  EmployeeRuntimeProfile,
} from '@/core/employee/contract';

export interface EmployeeRuntimeSetupRequest {
  name: string;
  packageId?: string;
  packageVersion?: string;
  employeeId?: string;
  hireId?: string;
  enrollmentCode?: string;
  enrollmentUrl?: string;
  defaultInitPrompt?: { zh?: string; en?: string };
  level: EmployeeMaturityLevel;
  profile: EmployeeRuntimeProfile;
  /**
   * Optional first message the user already typed before the workspace-setup
   * dialog interrupted them. Restored into the new employee conversation's input
   * (via chatStore.setPendingInput) AFTER the dialog opens it, so the text isn't
   * lost. Only set by the new-conversation path (ChatView), not by deep-link install.
   */
  pendingInput?: string;
}

/**
 * Deep-link install flow state — purely ephemeral by design (no persist):
 * a pending request only makes sense while the app instance that received
 * the fuyao:// URL is alive. The confirm dialog renders off `pending`;
 * `installing` guards against double-confirm while a download is running.
 */
interface DeepLinkState {
  pending: DeepLinkInstallRequest | null;
  installing: boolean;
  runtimeSetup: EmployeeRuntimeSetupRequest | null;
}

interface DeepLinkActions {
  setPending: (req: DeepLinkInstallRequest) => void;
  clearPending: () => void;
  setInstalling: (installing: boolean) => void;
  setRuntimeSetup: (request: EmployeeRuntimeSetupRequest) => void;
  clearRuntimeSetup: () => void;
}

export type DeepLinkStore = DeepLinkState & DeepLinkActions;

export const useDeepLinkStore = create<DeepLinkStore>()((set) => ({
  pending: null,
  installing: false,
  runtimeSetup: null,

  setPending: (req) => set({ pending: req }),
  clearPending: () => set({ pending: null }),
  setInstalling: (installing) => set({ installing }),
  setRuntimeSetup: (runtimeSetup) => set({ runtimeSetup }),
  clearRuntimeSetup: () => set({ runtimeSetup: null }),
}));
