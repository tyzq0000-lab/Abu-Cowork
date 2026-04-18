import { create } from 'zustand';
import type { SkillMetadata, SubagentMetadata } from '../types';
import { skillLoader } from '../core/skill/loader';
import { agentRegistry } from '../core/agent/registry';
import { useSettingsStore } from './settingsStore';
import { useWorkspaceStore } from './workspaceStore';

interface DiscoveryState {
  skills: SkillMetadata[];
  agents: SubagentMetadata[];
  isLoading: boolean;
}

interface DiscoveryActions {
  refresh: () => Promise<void>;
}

export type DiscoveryStore = DiscoveryState & DiscoveryActions;

export const useDiscoveryStore = create<DiscoveryStore>()((set) => ({
  skills: [],
  agents: [],
  isLoading: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      // Pass current workspace to the loader so project-scoped and
      // agent-written skills are included in the discovery.
      const wp = useWorkspaceStore.getState().currentPath;
      const [skills, agents] = await Promise.all([
        skillLoader.discoverSkills(wp),
        agentRegistry.discoverAgents(),
      ]);

      // Auto-disable project-level skills on first discovery (opt-in model).
      // Users must explicitly enable them in the Skills panel.
      const projectSkillNames = skills
        .filter((s) => s.source === 'project' || s.source === 'project-standard')
        .map((s) => s.name);
      if (projectSkillNames.length > 0) {
        useSettingsStore.getState().autoDisableProjectSkills(projectSkillNames);
      }

      set({ skills, agents, isLoading: false });
    } catch (err) {
      console.warn('Discovery refresh failed:', err);
      set({ isLoading: false });
    }
  },
}));

// ── Auto-re-discover on workspace switch ────────────────────────────────
//
// App.tsx already triggers an initial `refresh()` at boot. This subscription
// only kicks in for subsequent workspace changes — switching workspaces
// should replace the project/project-standard/workspace-auto/draft scope
// without requiring a manual refresh.
//
// Module-level subscribe registers once per process. Fire-and-forget: the
// refresh action handles its own errors.
let lastWorkspaceForDiscovery: string | null | undefined;
useWorkspaceStore.subscribe((state) => {
  if (state.currentPath !== lastWorkspaceForDiscovery) {
    lastWorkspaceForDiscovery = state.currentPath;
    void useDiscoveryStore.getState().refresh();
  }
});
