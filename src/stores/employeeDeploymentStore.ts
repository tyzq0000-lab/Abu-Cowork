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
  /**
   * Identity as minted on the platform, captured once at enrollment. Rendering
   * prefers these over whatever the package manifest declares, so a hired
   * employee wears the same name and face here as on the platform. Absent for
   * packages installed outside the platform — those keep their own identity.
   */
  platformDisplayName?: string;
  platformProfession?: string;
  platformAvatar?: string;
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
  /** 平台确认解除雇佣后清掉本地记录（部署行 + 签名期望）。 */
  forgetDeployment: (deploymentKey: string, agentName: string) => void;
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
      forgetDeployment: (deploymentKey, agentName) => set((state) => {
        const deployments = { ...state.deployments };
        delete deployments[deploymentKey];
        const integrity = { ...state.integrity };
        delete integrity[agentName];
        return { deployments, integrity };
      }),
    }),
    {
      name: 'abu-employee-deployments',
      version: 4,
      migrate: (persisted: unknown, version) => {
        const state = persisted as Partial<EmployeeDeploymentState>;
        if (version < 2) state.integrity = {};
        // v3 → v4 添加了 platformDisplayName / platformProfession / platformAvatar。
        // 三者全可选，老记录缺了它们正好回落到员工包自带的身份 —— 这就是期望行为，
        // 故无需回填。下次该员工重新部署时会自然带上平台身份。
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
