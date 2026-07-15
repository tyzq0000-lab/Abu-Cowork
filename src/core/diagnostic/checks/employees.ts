import { readTextFile } from '@tauri-apps/plugin-fs';
import { agentRegistry } from '@/core/agent/registry';
import { parseEmployeePlugin, type EmployeeRuntimeProfile } from '@/core/employee/contract';
import {
  checkEmployeeDependencies,
  type EmployeeDependencyHealth,
} from '@/core/employee/deploymentFlow';
import { assertEmployeePackageIntegrity } from '@/core/employee/packageIntegrity';
import { resolvePlatformRelayExecution } from '@/core/employee/platformRelay';
import { useEmployeeDeploymentStore, type EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { joinPath } from '@/utils/pathUtils';
import { getI18n } from '@/i18n';
import { mapAIServiceError } from '../errorMap';
import type { CheckResult, SuggestedAction } from '../types';
import { checkProviderHealthWithTimeout } from './aiServices';
import { probeWrite } from './permissions';

interface EmployeeTarget {
  key: string;
  agentName: string;
  deployment?: EmployeeDeploymentRecord;
}

function employeeAction(deployment: EmployeeDeploymentRecord | undefined): SuggestedAction | undefined {
  if (!deployment?.conversationId) return undefined;
  return {
    type: 'open-conversation',
    target: deployment.conversationId,
    label: getI18n().diagnostic.actionOpenEmployee,
  };
}

function stateLabel(health: EmployeeDependencyHealth): string {
  const t = getI18n().diagnostic;
  return {
    ready: t.employeeDependencyReady,
    'needs-authorization': t.employeeDependencyNeedsAuthorization,
    'available-to-configure': t.employeeDependencyNeedsConfiguration,
    unavailable: t.employeeDependencyUnavailable,
  }[health.state];
}

async function checkEmployee(target: EmployeeTarget): Promise<CheckResult[]> {
  const t = getI18n().diagnostic;
  const now = () => Date.now();
  const id = (part: string) => `employees:${target.key}:${part}`;
  const name = (part: string) => `${target.agentName} · ${part}`;
  const action = employeeAction(target.deployment);
  const agent = agentRegistry.getAgent(target.agentName);

  if (!agent || agent.source !== 'employee') {
    return [{
      id: id('package'),
      category: 'employees',
      name: name(t.employeePackage),
      status: 'failed',
      errorMessage: t.employeePackageMissing,
      errorDetail: target.deployment?.packageId,
      checkedAt: now(),
      durationMs: 0,
    }];
  }

  let runtime: EmployeeRuntimeProfile | undefined;
  const packageStart = now();
  try {
    const platformBound = Boolean(
      target.deployment?.deploymentId
      || target.deployment?.employeeId
      || target.deployment?.hireId,
    );
    if (platformBound && !useEmployeeDeploymentStore.getState().integrity[target.agentName]) {
      throw new Error(t.employeeSignatureMissing);
    }
    await assertEmployeePackageIntegrity(agent);
    if (agent.filePath.endsWith('plugin.json')) {
      const manifest = parseEmployeePlugin(await readTextFile(agent.filePath));
      if (!manifest?.runtime) throw new Error(t.employeeRuntimeInvalid);
      runtime = manifest.runtime;
    }
  } catch (error) {
    return [{
      id: id('package'),
      category: 'employees',
      name: name(t.employeePackage),
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      suggestedAction: action,
      checkedAt: now(),
      durationMs: now() - packageStart,
    }];
  }

  const rows: CheckResult[] = [{
    id: id('package'),
    category: 'employees',
    name: name(t.employeePackage),
    status: 'passed',
    metric: target.deployment?.deploymentId
      ? t.employeePackageSigned
      : t.employeePackageReady,
    checkedAt: now(),
    durationMs: now() - packageStart,
  }];

  const dependencies = runtime?.dependencies ?? [];
  const workspaceRequired = runtime?.workspace?.required === true
    || dependencies.some((dependency) => dependency.type === 'workspace' && dependency.required);
  const workspacePath = target.deployment?.workspacePath ?? null;
  if (!workspacePath) {
    rows.push({
      id: id('workspace'),
      category: 'employees',
      name: name(t.employeeWorkspace),
      status: workspaceRequired ? 'failed' : 'skipped',
      metric: workspaceRequired ? undefined : t.employeeWorkspaceOptional,
      errorMessage: workspaceRequired ? t.employeeWorkspaceMissing : undefined,
      suggestedAction: workspaceRequired ? action : undefined,
      checkedAt: now(),
      durationMs: 0,
    });
  } else {
    const probe = await probeWrite(joinPath(
      workspacePath,
      `.uprow-doctor-${crypto.randomUUID()}.tmp`,
    ));
    rows.push({
      id: id('workspace'),
      category: 'employees',
      name: name(t.employeeWorkspace),
      status: probe.ok ? 'passed' : 'failed',
      metric: probe.ok ? `${probe.durationMs}ms` : undefined,
      errorMessage: probe.ok ? undefined : t.employeeWorkspaceDenied,
      errorDetail: probe.error,
      suggestedAction: probe.ok ? undefined : action,
      checkedAt: now(),
      durationMs: probe.durationMs,
    });
  }

  const runtimeDependencies = dependencies.filter((dependency) => dependency.type !== 'workspace');
  const dependencyStart = now();
  const health = await checkEmployeeDependencies(runtimeDependencies, workspacePath);
  const missing = health.filter((dependency) => dependency.state !== 'ready');
  const blocking = missing.filter((dependency) => dependency.required);
  rows.push({
    id: id('dependencies'),
    category: 'employees',
    name: name(t.employeeDependencies),
    status: blocking.length > 0 ? 'failed' : missing.length > 0 ? 'warning' : 'passed',
    metric: health.length === 0
      ? t.employeeDependenciesNone
      : t.employeeDependenciesSummary
        .replace('{ready}', String(health.length - missing.length))
        .replace('{total}', String(health.length)),
    errorMessage: missing.length > 0 ? t.employeeDependenciesNeedAttention : undefined,
    errorDetail: missing.map((dependency) => `${dependency.name}: ${stateLabel(dependency)}`).join('\n') || undefined,
    suggestedAction: missing.length > 0 ? action : undefined,
    checkedAt: now(),
    durationMs: now() - dependencyStart,
  });

  const modelStart = now();
  const platformExpected = Boolean(
    target.deployment?.deploymentId
    || target.deployment?.employeeId
    || target.deployment?.hireId,
  );
  if (platformExpected) {
    try {
      if (!target.deployment?.deploymentId || !target.deployment.conversationId) {
        throw new Error(t.employeeModelBindingMissing);
      }
      const execution = await resolvePlatformRelayExecution(target.deployment.conversationId);
      if (!execution) throw new Error(t.employeeModelBindingMissing);
      const healthResult = await checkProviderHealthWithTimeout(execution.provider);
      if (!healthResult.success) throw new Error(healthResult.error || t.employeeModelUnavailable);
      rows.push({
        id: id('model'),
        category: 'employees',
        name: name(t.employeeModel),
        status: 'passed',
        metric: `${healthResult.latencyMs}ms · ${execution.modelId}`,
        checkedAt: now(),
        durationMs: now() - modelStart,
      });
    } catch (error) {
      rows.push({
        id: id('model'),
        category: 'employees',
        name: name(t.employeeModel),
        status: 'failed',
        errorMessage: t.employeeModelUnavailable,
        errorDetail: error instanceof Error ? error.message : String(error),
        suggestedAction: action,
        checkedAt: now(),
        durationMs: now() - modelStart,
      });
    }
  } else if (agent.providerId) {
    const provider = useSettingsStore.getState().providers.find((item) => item.id === agent.providerId);
    if (!provider) {
      rows.push({
        id: id('model'),
        category: 'employees',
        name: name(t.employeeModel),
        status: 'failed',
        errorMessage: t.employeeModelBindingMissing,
        suggestedAction: {
          type: 'open-settings',
          target: 'ai-services',
          label: t.actionOpenAIServices,
        },
        checkedAt: now(),
        durationMs: 0,
      });
    } else {
      const healthResult = await checkProviderHealthWithTimeout(provider);
      const friendly = healthResult.success ? null : mapAIServiceError({
        errorCode: healthResult.errorCode,
        statusCode: healthResult.statusCode,
        rawMessage: healthResult.error ?? '',
      });
      rows.push({
        id: id('model'),
        category: 'employees',
        name: name(t.employeeModel),
        status: healthResult.success ? 'passed' : 'failed',
        metric: healthResult.success ? `${healthResult.latencyMs}ms` : undefined,
        errorMessage: friendly?.message,
        errorDetail: healthResult.error,
        suggestedAction: friendly?.action,
        checkedAt: now(),
        durationMs: now() - modelStart,
      });
    }
  } else {
    rows.push({
      id: id('model'),
      category: 'employees',
      name: name(t.employeeModel),
      status: 'skipped',
      metric: t.employeeModelUsesGlobal,
      checkedAt: now(),
      durationMs: 0,
    });
  }

  return rows;
}

export async function runEmployeeChecks(): Promise<CheckResult[]> {
  const deployments = useEmployeeDeploymentStore.getState().deployments;
  const targets: EmployeeTarget[] = Object.entries(deployments).map(([key, deployment]) => ({
    key,
    agentName: deployment.agentName,
    deployment,
  }));
  const deployedNames = new Set(targets.map((target) => target.agentName));
  for (const agent of agentRegistry.getAvailableAgents()) {
    if (agent.source === 'employee' && !deployedNames.has(agent.name)) {
      targets.push({ key: `local-${agent.name}`, agentName: agent.name });
    }
  }

  if (targets.length === 0) {
    const t = getI18n().diagnostic;
    return [{
      id: 'employees:none',
      category: 'employees',
      name: t.employeeNone,
      status: 'skipped',
      metric: t.employeeNoneHint,
      checkedAt: Date.now(),
      durationMs: 0,
    }];
  }

  return (await Promise.all(targets.map(checkEmployee))).flat();
}
