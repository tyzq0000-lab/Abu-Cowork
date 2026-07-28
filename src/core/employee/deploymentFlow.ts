import type { ConversationMeta } from '@/core/session/conversationStorage';
import { useChatStore } from '@/stores/chatStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { EmployeeDependency, LocalePair } from './contract';
import type { EmployeePlatformBinding } from './deploymentEnrollment';
import { hasEmbeddedPython } from '@/utils/pythonRuntime';
import { probeCommands } from '@/utils/commandProbe';

export interface EmployeeDependencyHealth {
  name: string;
  required: boolean;
  state: 'ready' | 'needs-authorization' | 'available-to-configure' | 'unavailable';
  description?: string;
}

export function summarizeEmployeeDependencies(
  dependencies: EmployeeDependency[],
  workspacePath: string | null,
  runtimeAvailability: { python: boolean; commands?: Record<string, boolean> },
): EmployeeDependencyHealth[] {
  return dependencies.map((dependency) => {
    if (dependency.type === 'workspace') {
      return {
        name: dependency.name,
        required: dependency.required,
        state: workspacePath ? 'ready' : 'unavailable',
        description: dependency.description,
      };
    }
    if (dependency.runtimeId === 'python') {
      return {
        name: dependency.name,
        required: dependency.required,
        state: runtimeAvailability.python ? 'ready' : 'unavailable',
        description: dependency.description,
      };
    }
    if (dependency.type === 'command') {
      // 真去机器上查（where/which）。查到=ready，确实没装=unavailable（照旧拦住，
      // 但现在弹窗能说清缺的是什么）；探测没跑（undefined）才退回"可稍后配置"。
      const probed = runtimeAvailability.commands?.[dependency.name.trim()];
      return {
        name: dependency.name,
        required: dependency.required,
        state: probed === undefined ? 'available-to-configure' : probed ? 'ready' : 'unavailable',
        description: dependency.description,
      };
    }
    if (dependency.type === 'account' || dependency.type === 'service') {
      return {
        name: dependency.name,
        required: dependency.required,
        state: dependency.required ? 'needs-authorization' : 'available-to-configure',
        description: dependency.description,
      };
    }
    return {
      name: dependency.name,
      required: dependency.required,
      state: 'available-to-configure',
      description: dependency.description,
    };
  });
}

export async function checkEmployeeDependencies(
  dependencies: EmployeeDependency[],
  workspacePath: string | null,
): Promise<EmployeeDependencyHealth[]> {
  const needsPython = dependencies.some((dependency) => dependency.runtimeId === 'python');
  const commandNames = dependencies
    .filter((dependency) => dependency.type === 'command' && dependency.runtimeId !== 'python')
    .map((dependency) => dependency.name);
  const [python, commands] = await Promise.all([
    needsPython ? hasEmbeddedPython() : Promise.resolve(false),
    commandNames.length ? probeCommands(commandNames) : Promise.resolve({}),
  ]);
  return summarizeEmployeeDependencies(dependencies, workspacePath, { python, commands });
}

/**
 * 只有**查实了确实不满足**的必需项才拦部署。
 *
 * 以前是 `state !== 'ready'` 就拦，于是两类依赖永远部署不了：
 * ① 非 Python 的命令依赖 —— 代码压根没探测，恒为 available-to-configure；
 * ② 必需的账号/服务授权 —— 恒为 needs-authorization，而授权本来就只能等到
 *    真正开工、在对话里发生，部署时无从完成。
 * 现在 command 有了真实探测（查不到 → unavailable，照拦），而"只能稍后做"的两类
 * 不再挡在部署门口，改由弹窗把未满足项列清楚，让用户知道开工前还差什么。
 */
export function hasBlockingEmployeeDependencies(health: EmployeeDependencyHealth[]): boolean {
  return health.some((dependency) => dependency.required && dependency.state === 'unavailable');
}

/** 必需但尚未就绪的项（含只能稍后完成的授权），供弹窗把"还差什么"列出来。 */
export function unmetEmployeeDependencies(health: EmployeeDependencyHealth[]): EmployeeDependencyHealth[] {
  return health.filter((dependency) => dependency.required && dependency.state !== 'ready');
}

export function chooseDefaultInitPrompt(
  prompt: LocalePair | undefined,
  locale: 'zh' | 'en' = 'zh',
): string | undefined {
  if (!prompt) return undefined;
  return locale === 'zh'
    ? prompt.zh || prompt.en
    : prompt.en || prompt.zh;
}

export function findExistingEmployeeConversation(
  index: Record<string, ConversationMeta>,
  agentName: string,
  workspacePath: string | null,
): string | undefined {
  return Object.values(index)
    .filter(
      (conversation) =>
        conversation.agentName === agentName
        && (conversation.workspacePath ?? null) === workspacePath,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
}

export interface CompleteEmployeeDeploymentInput {
  packageId: string;
  packageVersion?: string;
  employeeId?: string;
  agentName: string;
  workspacePath: string | null;
  defaultInitPrompt?: LocalePair;
  platformBinding?: EmployeePlatformBinding;
}

export async function completeEmployeeDeployment(
  input: CompleteEmployeeDeploymentInput,
): Promise<{ conversationId: string; created: boolean }> {
  await useDiscoveryStore.getState().refresh(input.workspacePath);
  const installed = useDiscoveryStore
    .getState()
    .agents
    .some((agent) => agent.name === input.agentName);
  if (!installed) {
    throw new Error(`Installed employee "${input.agentName}" was not found after discovery refresh.`);
  }

  const chat = useChatStore.getState();
  const deployments = useEmployeeDeploymentStore.getState().deployments;
  const deployment = input.platformBinding?.hireId
    ? Object.values(deployments).find((record) => record.hireId === input.platformBinding?.hireId)
    : deployments[input.packageId];
  const recordedConversation =
    deployment?.conversationId && chat.conversationIndex[deployment.conversationId]
      ? deployment.conversationId
      : undefined;
  const existingConversation = recordedConversation
    ?? (input.platformBinding
      ? undefined
      : findExistingEmployeeConversation(
          chat.conversationIndex,
          input.agentName,
          input.workspacePath,
        ));

  let conversationId: string;
  let created = false;
  if (existingConversation) {
    conversationId = existingConversation;
    await chat.switchConversation(existingConversation);
  } else {
    conversationId = chat.createConversation(input.workspacePath, {
      agentName: input.agentName,
    });
    created = true;
    const prompt = chooseDefaultInitPrompt(input.defaultInitPrompt);
    if (prompt) {
      chat.addMessage(conversationId, {
        id: `employee-init-${Date.now().toString(36)}`,
        role: 'assistant',
        content: prompt,
        timestamp: Date.now(),
      });
    }
  }

  useEmployeeDeploymentStore.getState().saveDeployment({
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    employeeId: input.employeeId ?? deployment?.employeeId,
    hireId: input.platformBinding?.hireId ?? deployment?.hireId,
    deploymentId: input.platformBinding?.deploymentId ?? deployment?.deploymentId,
    ledgerEndpoint: input.platformBinding?.ledgerEndpoint ?? deployment?.ledgerEndpoint,
    heartbeatEndpoint: input.platformBinding?.heartbeatEndpoint ?? deployment?.heartbeatEndpoint,
    relayBaseUrl: input.platformBinding?.relayBaseUrl ?? deployment?.relayBaseUrl,
    relayModel: input.platformBinding?.relayModel ?? deployment?.relayModel,
    integrityKeyId: useEmployeeDeploymentStore.getState().integrity[input.agentName]?.keyId,
    integrityManifestSha256: useEmployeeDeploymentStore.getState().integrity[input.agentName]?.manifestSha256,
    agentName: input.agentName,
    workspacePath: input.workspacePath,
    conversationId,
    configuredAt: Date.now(),
  });
  useSettingsStore.getState().setViewMode('chat');

  return { conversationId, created };
}
