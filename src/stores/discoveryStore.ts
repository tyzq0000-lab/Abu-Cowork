import { create } from 'zustand';
import type { SkillMetadata, SubagentMetadata } from '../types';
import { skillLoader } from '../core/skill/loader';
import { agentRegistry } from '../core/agent/registry';
import { useSettingsStore } from './settingsStore';

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
      const [skills, agents] = await Promise.all([
        skillLoader.discoverSkills(),
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
