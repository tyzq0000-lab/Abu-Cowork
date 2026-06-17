import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface EmployeeDeploymentRecord {
  packageId: string;
  packageVersion?: string;
  employeeId?: string;
  agentName: string;
  workspacePath: string | null;
  conversationId?: string;
  configuredAt: number;
}

interface EmployeeDeploymentState {
  deployments: Record<string, EmployeeDeploymentRecord>;
  saveDeployment: (record: EmployeeDeploymentRecord) => void;
}

export const useEmployeeDeploymentStore = create<EmployeeDeploymentState>()(
  persist(
    (set) => ({
      deployments: {},
      saveDeployment: (record) => set((state) => ({
        deployments: {
          ...state.deployments,
          [record.packageId]: record,
        },
      })),
    }),
    {
      name: 'abu-employee-deployments',
      version: 1,
    },
  ),
);
