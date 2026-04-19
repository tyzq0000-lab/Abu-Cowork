/**
 * Project hint store — remembers which workspace paths the user has
 * explicitly dismissed from the "promote to project" suggestion on the
 * welcome screen. Persisted so "忽略" is a forever-choice, not a
 * per-session annoyance.
 *
 * Keyed by raw workspacePath string. Matches the same string the user
 * picks via FolderSelector, so no path normalization is needed here —
 * if a normalization-induced mismatch ever surfaces, it'd be the same
 * bug that affects project ↔ conversation auto-association and should
 * be fixed centrally in pathUtils, not here.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProjectHintState {
  dismissedWorkspaces: string[];
}

interface ProjectHintActions {
  dismiss: (workspacePath: string) => void;
  /** Test / settings-UI helper to clear all dismissals. */
  clearDismissed: () => void;
}

export type ProjectHintStore = ProjectHintState & ProjectHintActions;

export const useProjectHintStore = create<ProjectHintStore>()(
  persist(
    (set) => ({
      dismissedWorkspaces: [],
      dismiss: (workspacePath) => {
        set((state) =>
          state.dismissedWorkspaces.includes(workspacePath)
            ? state
            : { dismissedWorkspaces: [...state.dismissedWorkspaces, workspacePath] },
        );
      },
      clearDismissed: () => {
        set({ dismissedWorkspaces: [] });
      },
    }),
    {
      name: 'abu-project-hint',
      version: 1,
      partialize: (state) => ({ dismissedWorkspaces: state.dismissedWorkspaces }),
    },
  ),
);
