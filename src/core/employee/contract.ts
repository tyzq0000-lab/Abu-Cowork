import type { ScheduleConfig } from '@/types/schedule';
import type {
  TriggerCapability,
  TriggerFilter,
  TriggerPermissions,
  TriggerSource,
} from '@/types/trigger';

export type EmployeeMaturityLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type EmployeeGapOwner =
  | 'employee-package'
  | 'fuyao-runtime'
  | 'runtime-config'
  | 'external-service';

export interface EmployeeDependency {
  name: string;
  type: 'command' | 'environment' | 'workspace' | 'service' | 'account';
  required: boolean;
  description?: string;
  platforms?: string[];
}

export interface EmployeeSourceCapability {
  name: string;
  origin: string;
  license: string;
  integration: 'adapted' | 'wrapped' | 'rewritten' | 'external-service';
  adoptedCapabilities: string[];
  excludedCapabilities: string[];
  exclusionReasons: string[];
  recoveryCost: 'low' | 'medium' | 'high';
}

interface EmployeeWorkflowBase {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  skillName?: string;
  recommended?: boolean;
}

export interface EmployeeScheduleTemplate extends EmployeeWorkflowBase {
  kind: 'schedule';
  schedule: ScheduleConfig;
}

export interface EmployeeTriggerTemplate extends EmployeeWorkflowBase {
  kind: 'trigger';
  source: TriggerSource;
  filter: TriggerFilter;
  capability?: TriggerCapability;
  permissions?: TriggerPermissions;
}

export type EmployeeWorkflowTemplate = EmployeeScheduleTemplate | EmployeeTriggerTemplate;

export interface EmployeeRuntimeProfile {
  version: 1;
  targetMaturity?: 'L2' | 'L3';
  memory?: {
    scope: 'session' | 'project' | 'user';
    autoCapture?: Array<'preference' | 'feedback' | 'failure' | 'project' | 'reference'>;
  };
  workflows?: EmployeeWorkflowTemplate[];
  review?: {
    cadence?: string;
    metrics: Array<{
      id: string;
      name: string;
      description: string;
      target?: string;
    }>;
  };
  evolution?: {
    memoryWrites: 'auto' | 'approval';
    capabilityChanges: 'approval';
    workflowChanges: 'approval';
    triggerChanges: 'approval';
  };
  escalation?: {
    conditions: string[];
    fallback: string;
  };
  acceptance?: Array<{
    name: string;
    prompt: string;
    assertions: string[];
  }>;
  dependencies?: EmployeeDependency[];
  sources?: EmployeeSourceCapability[];
}

/**
 * Maker-configured model binding, injected by the uprow platform at mint
 * time. The enterprise user never sees keys or model names — the desktop
 * registers a dedicated provider on install and blanks the apiKey fields
 * in the on-disk plugin.json (live keys go to the encrypted secret store).
 */
export interface EmployeeModelConfig {
  provider: {
    apiFormat: 'anthropic' | 'openai-compatible';
    baseUrl: string;
    model: string;
    apiKey?: string;
  };
  imageGen?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
}

interface LocalePair {
  zh?: string;
  en?: string;
}

export interface EmployeePluginManifest {
  name?: string;
  agentName?: string;
  version?: string;
  expertType?: string;
  description?: string;
  agents?: string[];
  displayName?: LocalePair;
  profession?: LocalePair;
  displayDescription?: LocalePair;
  avatar?: string;
  categoryId?: string;
  tags?: LocalePair[];
  quickPrompts?: LocalePair[];
  defaultInitPrompt?: LocalePair;
  skills?: string[];
  modelConfig?: EmployeeModelConfig;
  runtime?: EmployeeRuntimeProfile;
}

export interface EmployeeAuditGap {
  owner: EmployeeGapOwner;
  code: string;
  message: string;
  blocking: boolean;
}

export interface CapabilityLedgerEntry {
  source: string;
  origin: string;
  license: string;
  integration: EmployeeSourceCapability['integration'];
  adopted: string[];
  excluded: string[];
  exclusionReasons: string[];
  recoveryCost: EmployeeSourceCapability['recoveryCost'];
}

export interface EmployeeAuditReport {
  level: EmployeeMaturityLevel;
  targetLevel: EmployeeMaturityLevel;
  score: number;
  gaps: EmployeeAuditGap[];
  capabilityLedger: CapabilityLedgerEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === 'string';
}

function isWorkflowTemplate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.prompt !== 'string'
  ) {
    return false;
  }
  if (
    !hasOptionalString(value, 'description')
    || !hasOptionalString(value, 'skillName')
    || (value.recommended !== undefined && typeof value.recommended !== 'boolean')
  ) {
    return false;
  }
  if (value.kind === 'schedule') {
    if (!isRecord(value.schedule)) return false;
    const frequency = value.schedule.frequency;
    if (!['hourly', 'daily', 'weekly', 'weekdays', 'manual'].includes(String(frequency))) {
      return false;
    }
    if (value.schedule.dayOfWeek !== undefined) {
      if (
        typeof value.schedule.dayOfWeek !== 'number'
        || value.schedule.dayOfWeek < 0
        || value.schedule.dayOfWeek > 6
      ) return false;
    }
    if (value.schedule.time !== undefined) {
      if (!isRecord(value.schedule.time)) return false;
      const { hour, minute } = value.schedule.time;
      if (
        typeof hour !== 'number'
        || typeof minute !== 'number'
        || hour < 0
        || hour > 23
        || minute < 0
        || minute > 59
      ) return false;
    }
    return true;
  }
  if (value.kind === 'trigger') {
    if (!isRecord(value.source) || !isRecord(value.filter)) return false;
    if (!['http', 'file', 'cron', 'im'].includes(String(value.source.type))) return false;
    if (!['always', 'keyword', 'regex'].includes(String(value.filter.type))) return false;
    if (value.permissions !== undefined && !isRecord(value.permissions)) return false;
    return value.capability === undefined
      || ['read_tools', 'safe_tools', 'full', 'custom'].includes(String(value.capability));
  }
  return false;
}

function isReview(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.metrics)) return false;
  if (!hasOptionalString(value, 'cadence')) return false;
  return value.metrics.every((metric) =>
    isRecord(metric)
    && typeof metric.id === 'string'
    && typeof metric.name === 'string'
    && typeof metric.description === 'string'
    && hasOptionalString(metric, 'target'));
}

function isEvolution(value: unknown): boolean {
  return isRecord(value)
    && ['auto', 'approval'].includes(String(value.memoryWrites))
    && value.capabilityChanges === 'approval'
    && value.workflowChanges === 'approval'
    && value.triggerChanges === 'approval';
}

function isEscalation(value: unknown): boolean {
  return isRecord(value)
    && isStringArray(value.conditions)
    && typeof value.fallback === 'string';
}

function isAcceptance(value: unknown): boolean {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.prompt === 'string'
    && isStringArray(value.assertions);
}

function isDependency(value: unknown): boolean {
  return isRecord(value)
    && typeof value.name === 'string'
    && ['command', 'environment', 'workspace', 'service', 'account'].includes(String(value.type))
    && typeof value.required === 'boolean'
    && hasOptionalString(value, 'description')
    && (value.platforms === undefined || isStringArray(value.platforms));
}

function isSourceCapability(value: unknown): boolean {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.origin === 'string'
    && typeof value.license === 'string'
    && ['adapted', 'wrapped', 'rewritten', 'external-service'].includes(String(value.integration))
    && isStringArray(value.adoptedCapabilities)
    && isStringArray(value.excludedCapabilities)
    && isStringArray(value.exclusionReasons)
    && ['low', 'medium', 'high'].includes(String(value.recoveryCost));
}

function isRuntimeProfile(value: unknown): value is EmployeeRuntimeProfile {
  if (!isRecord(value) || value.version !== 1) return false;
  if (
    value.targetMaturity !== undefined
    && value.targetMaturity !== 'L2'
    && value.targetMaturity !== 'L3'
  ) {
    return false;
  }
  if (value.memory !== undefined) {
    if (!isRecord(value.memory)) return false;
    if (!['session', 'project', 'user'].includes(String(value.memory.scope))) return false;
    if (value.memory.autoCapture !== undefined && !isStringArray(value.memory.autoCapture)) {
      return false;
    }
  }
  if (
    value.workflows !== undefined
    && (!Array.isArray(value.workflows) || !value.workflows.every(isWorkflowTemplate))
  ) {
    return false;
  }
  if (value.review !== undefined) {
    if (!isReview(value.review)) return false;
  }
  if (value.evolution !== undefined && !isEvolution(value.evolution)) return false;
  if (value.escalation !== undefined && !isEscalation(value.escalation)) return false;
  if (
    value.acceptance !== undefined
    && (!Array.isArray(value.acceptance) || !value.acceptance.every(isAcceptance))
  ) return false;
  if (
    value.dependencies !== undefined
    && (!Array.isArray(value.dependencies) || !value.dependencies.every(isDependency))
  ) return false;
  if (
    value.sources !== undefined
    && (!Array.isArray(value.sources) || !value.sources.every(isSourceCapability))
  ) return false;
  return true;
}

/** Provider id for an employee's dedicated (modelConfig-injected) provider. */
export function employeeProviderId(agentName: string): string {
  return `employee:${agentName}`;
}

export function parseEmployeePlugin(raw: string): EmployeePluginManifest | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const manifest = { ...(parsed as Record<string, unknown>) } as EmployeePluginManifest;
    if (manifest.runtime !== undefined && !isRuntimeProfile(manifest.runtime)) {
      delete manifest.runtime;
    }
    return manifest;
  } catch {
    return null;
  }
}

function normalizePackagePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function dependencyOwner(type: EmployeeDependency['type']): EmployeeGapOwner {
  return type === 'account' || type === 'service' ? 'external-service' : 'runtime-config';
}

export function auditEmployeePackage(input: {
  manifest: EmployeePluginManifest | null;
  files: string[];
}): EmployeeAuditReport {
  const manifest = input.manifest;
  const files = new Set(input.files.map(normalizePackagePath));
  const gaps: EmployeeAuditGap[] = [];
  const addGap = (
    owner: EmployeeGapOwner,
    code: string,
    message: string,
    blocking = true,
  ) => gaps.push({ owner, code, message, blocking });
  const hasFile = (path: string) => files.has(normalizePackagePath(path));

  if (!manifest || !(manifest.agentName || manifest.name)) {
    addGap('employee-package', 'INVALID_MANIFEST', '缺少可识别的 plugin.json 或员工标识');
    return { level: 'L0', targetLevel: 'L3', score: 0, gaps, capabilityLedger: [] };
  }

  const declaredAgents = manifest.agents ?? [];
  const declaredSkills = manifest.skills ?? [];
  if (declaredAgents.length === 0) {
    addGap('employee-package', 'MISSING_AGENT', '未声明 agents/*.md 身份与岗位指令');
  } else {
    for (const path of declaredAgents) {
      if (!hasFile(path)) {
        addGap('employee-package', 'MISSING_AGENT_FILE', `声明的身份文件不存在：${path}`);
      }
    }
  }
  if (declaredSkills.length === 0) {
    addGap('employee-package', 'MISSING_SKILLS', '未声明可执行的岗位技能');
  } else {
    for (const path of declaredSkills) {
      const skillPath = `${normalizePackagePath(path)}/SKILL.md`;
      if (!hasFile(skillPath)) {
        addGap('employee-package', 'MISSING_SKILL_FILE', `声明的技能入口不存在：${skillPath}`);
      }
    }
  }
  if (manifest.avatar && !hasFile(manifest.avatar)) {
    addGap(
      'employee-package',
      'MISSING_AVATAR_FILE',
      `声明的头像文件不存在：${manifest.avatar}`,
      false,
    );
  }

  const structuralBlockers = gaps.some(
    (gap) => gap.blocking && gap.owner === 'employee-package',
  );
  let level: EmployeeMaturityLevel = structuralBlockers ? 'L0' : 'L1';
  const runtime = manifest.runtime;

  if (!runtime) {
    addGap(
      'employee-package',
      'MISSING_RUNTIME_CONTRACT',
      '缺少默认工作流、长期记忆、复盘和进化等运行契约',
    );
  } else {
    const persistentMemory =
      runtime.memory?.scope === 'project' || runtime.memory?.scope === 'user';
    const hasWorkflow = (runtime.workflows?.length ?? 0) > 0;

    if (!persistentMemory) {
      addGap('employee-package', 'NON_PERSISTENT_MEMORY', '员工未声明项目级或用户级长期记忆');
    }
    if (!hasWorkflow) {
      addGap('employee-package', 'MISSING_WORKFLOW_TEMPLATES', '员工未声明可确认启用的工作模板');
    }
    if (!structuralBlockers && persistentMemory && hasWorkflow) level = 'L2';

    const hasRecommendedWorkflow =
      runtime.workflows?.some((workflow) => workflow.recommended === true) ?? false;
    const hasReview = (runtime.review?.metrics.length ?? 0) > 0;
    const governedEvolution =
      runtime.evolution?.memoryWrites === 'auto'
      && runtime.evolution.capabilityChanges === 'approval'
      && runtime.evolution.workflowChanges === 'approval'
      && runtime.evolution.triggerChanges === 'approval';
    const hasEscalation =
      (runtime.escalation?.conditions.length ?? 0) > 0
      && Boolean(runtime.escalation?.fallback);
    const hasAcceptance = (runtime.acceptance?.length ?? 0) > 0;
    const sources = runtime.sources ?? [];
    const ledgerComplete = sources.length > 0 && sources.every(
      (source) =>
        Boolean(source.origin)
        && Boolean(source.license)
        && source.adoptedCapabilities.length > 0
        && source.excludedCapabilities.length === source.exclusionReasons.length,
    );

    if (!hasRecommendedWorkflow) {
      addGap('employee-package', 'NO_RECOMMENDED_WORKFLOW', '没有标记安装后推荐展示的岗位工作模板');
    }
    if (!hasReview) addGap('employee-package', 'MISSING_REVIEW_METRICS', '没有可度量的复盘指标');
    if (!governedEvolution) {
      addGap('employee-package', 'UNGOVERNED_EVOLUTION', '未声明“记忆自动、能力变更审批”的进化边界');
    }
    if (!hasEscalation) {
      addGap('employee-package', 'MISSING_ESCALATION', '没有异常处理和人工升级条件');
    }
    if (!hasAcceptance) {
      addGap('employee-package', 'MISSING_ACCEPTANCE_CASES', '没有可重复执行的端到端验收案例');
    }
    if (!ledgerComplete) {
      addGap('employee-package', 'INCOMPLETE_SOURCE_LEDGER', '开源能力采用与裁剪账本不完整');
    }

    for (const dependency of runtime.dependencies ?? []) {
      if (!dependency.required) continue;
      addGap(
        dependencyOwner(dependency.type),
        `DEPENDENCY_${dependency.type.toUpperCase()}`,
        `运行前需要配置：${dependency.name}`,
        false,
      );
    }

    if (
      level === 'L2'
      && hasRecommendedWorkflow
      && hasReview
      && governedEvolution
      && hasEscalation
      && hasAcceptance
      && ledgerComplete
    ) {
      level = 'L3';
    }
  }

  return {
    level,
    targetLevel: runtime?.targetMaturity ?? 'L3',
    score: { L0: 0, L1: 30, L2: 70, L3: 100 }[level],
    gaps,
    capabilityLedger: (runtime?.sources ?? []).map((source) => ({
      source: source.name,
      origin: source.origin,
      license: source.license,
      integration: source.integration,
      adopted: source.adoptedCapabilities,
      excluded: source.excludedCapabilities,
      exclusionReasons: source.exclusionReasons,
      recoveryCost: source.recoveryCost,
    })),
  };
}
