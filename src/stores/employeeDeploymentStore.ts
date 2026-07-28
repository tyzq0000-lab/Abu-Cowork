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

/**
 * Whether this agent is a platform-deployed (signed) employee.
 *
 * 这类员工由平台中继供模型，**企业侧不需要、也不该被要求配任何 API Key**（已锁的
 * Q1/Q2：企业永不见 key/token/模型配置）。UI 上任何"去配 key"的提示都要先绕开它。
 * 传 deployments 快照即可在 zustand selector 里同步用，不必新开订阅。
 */
export function hasPlatformDeployment(
  deployments: Record<string, EmployeeDeploymentRecord>,
  agentName: string | null,
): boolean {
  if (!agentName) return false;
  return Object.values(deployments).some(
    (d) => d.agentName === agentName && !!d.deploymentId,
  );
}
