import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PackageIntegrityExpectation } from '@/core/employee/packageIntegrity';

export interface EmployeeDeploymentRecord {
  packageId: string;
  packageVersion?: string;
  employeeId?: string;
  hireId?: string;
  deploymentId?: string;
  ledgerEndpoint?: string;
  heartbeatEndpoint?: string;
  relayBaseUrl?: string;
  relayModel?: string;
  integrityKeyId?: string;
  integrityManifestSha256?: string;
  agentName: string;
  workspacePath: string | null;
  conversationId?: string;
  configuredAt: number;
}

interface EmployeeDeploymentState {
  deployments: Record<string, EmployeeDeploymentRecord>;
  integrity: Record<string, PackageIntegrityExpectation>;
  saveDeployment: (record: EmployeeDeploymentRecord) => void;
  saveIntegrity: (agentName: string, expectation: PackageIntegrityExpectation) => void;
}

export const useEmployeeDeploymentStore = create<EmployeeDeploymentState>()(
  persist(
    (set) => ({
      deployments: {},
      integrity: {},
      saveDeployment: (record) => set((state) => {
        const deployments = { ...state.deployments };
        if (record.hireId) {
          for (const [key, existing] of Object.entries(deployments)) {
            if (existing.hireId === record.hireId) delete deployments[key];
          }
        }
        deployments[record.deploymentId ?? record.packageId] = record;
        return { deployments };
      }),
      saveIntegrity: (agentName, expectation) => set((state) => ({
        integrity: {
          ...state.integrity,
          [agentName]: expectation,
        },
      })),
    }),
    {
      name: 'abu-employee-deployments',
      version: 3,
      migrate: (persisted: unknown, version) => {
        const state = persisted as Partial<EmployeeDeploymentState>;
        if (version < 2) state.integrity = {};
        return state as EmployeeDeploymentState;
      },
    },
  ),
);
