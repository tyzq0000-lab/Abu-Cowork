import type { ScheduleConfig } from '@/types/schedule';
import type { AgentMemoryCapture, ToolPolicy } from '@/types';
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
  runtimeId?: 'python';
}

export interface EmployeeWorkspaceRequirement {
  required: boolean;
  selection: 'user-selected' | 'current-workspace';
  stateDirectory?: string;
  initializeWith?: string;
}

export type EmployeeCapabilityState =
  | 'ready'
  | 'needs-authorization'
  | 'available-to-configure'
  | 'unavailable'
  | 'fallback';

export interface EmployeeOnboarding {
  minimumInputCount?: number;
  clueTypes?: string[];
  setupMode?: string;
  platformSelection?: string;
  launchMode: 'create-or-open-conversation' | 'open-employee';
  incrementalUnlock?: boolean;
  coreMustRemainRunnable?: boolean;
  capabilityStates?: EmployeeCapabilityState[];
}

export interface EmployeeAuthorization {
  type: string;
  required: 'always' | 'when-used' | 'optional';
  description: string;
  fallback: string;
}

export interface EmployeeReliability {
  idempotency: {
    scope: string;
    keyFields: string[];
  };
  retry: {
    maxAttempts: number;
    retryableClasses: string[];
    nonRetryableClasses: string[];
  };
  errorClasses: string[];
  evidenceRequired: string[];
  humanEscalation: {
    afterConsecutiveFailures: number;
    preserveArtifacts: boolean;
    preserveLogs: boolean;
  };
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

/**
 * A workflow the user runs on demand (no schedule, no external trigger) —
 * the most basic automation shape. `permissions` is an optional allowlist of
 * capability tokens the manual run may use.
 */
export interface EmployeeManualTemplate extends EmployeeWorkflowBase {
  kind: 'manual';
  permissions?: string[];
}

export type EmployeeWorkflowTemplate =
  | EmployeeScheduleTemplate
  | EmployeeTriggerTemplate
  | EmployeeManualTemplate;

export interface EmployeeRuntimeProfile {
  version: 1;
  /**
   * Which execution engine runs this employee's tasks (project06 M1).
   * - 'native'  — Fuyao's built-in TS agent loop (existing behaviour).
   * - 'codex'   — embedded Codex engine (sidecar) for file/script/workspace tasks.
   * - 'auto'    — router decides per task.
   * Omitted → the router treats the package as 'native', so existing packages
   * are regression-safe (they never opt into codex implicitly).
   */
  engine?: 'codex' | 'native' | 'auto';
  /** Package-owned least-privilege policy. Omitted means all tools enabled. */
  toolPolicy?: ToolPolicy;
  targetMaturity?: 'L2' | 'L3';
  workspace?: EmployeeWorkspaceRequirement;
  onboarding?: EmployeeOnboarding;
  memory?: {
    scope: 'session' | 'project' | 'user';
    autoCapture?: AgentMemoryCapture[];
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
  authorizations?: EmployeeAuthorization[];
  reliability?: EmployeeReliability;
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

export interface LocalePair {
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

function isToolPolicy(value: unknown): value is ToolPolicy {
  if (!isRecord(value) || !isRecord(value.overrides)) return false;
  if (
    value.default !== undefined
    && value.default !== 'enabled'
    && value.default !== 'disabled'
  ) return false;
  return Object.entries(value.overrides).every(([pattern, state]) =>
    pattern.trim().length > 0
    && pattern === pattern.trim()
    && !pattern.includes('(')
    && !pattern.includes(')')
    && (state === 'enabled' || state === 'disabled'));
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
  if (value.kind === 'manual') {
    return value.permissions === undefined || isStringArray(value.permissions);
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
    // Cron sources must carry a finite interval >= 10s. A missing/NaN interval
    // would otherwise slip past the engine's `intervalMs < 10_000` guard
    // (NaN < 10_000 is false) and spin a 0/NaN-delay setInterval.
    if (value.source.type === 'cron') {
      const interval = value.source.intervalSeconds;
      if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 10) return false;
    }
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
    && (value.platforms === undefined || isStringArray(value.platforms))
    && (value.runtimeId === undefined || value.runtimeId === 'python');
}

function isWorkspaceRequirement(value: unknown): boolean {
  return isRecord(value)
    && typeof value.required === 'boolean'
    && ['user-selected', 'current-workspace'].includes(String(value.selection))
    && hasOptionalString(value, 'stateDirectory')
    && hasOptionalString(value, 'initializeWith');
}

function isOnboarding(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!['create-or-open-conversation', 'open-employee'].includes(String(value.launchMode))) {
    return false;
  }
  if (
    value.minimumInputCount !== undefined
    && (
      typeof value.minimumInputCount !== 'number'
      || !Number.isInteger(value.minimumInputCount)
      || value.minimumInputCount < 0
    )
  ) return false;
  if (value.clueTypes !== undefined && !isStringArray(value.clueTypes)) return false;
  if (!hasOptionalString(value, 'setupMode') || !hasOptionalString(value, 'platformSelection')) {
    return false;
  }
  if (
    value.incrementalUnlock !== undefined
    && typeof value.incrementalUnlock !== 'boolean'
  ) return false;
  if (
    value.coreMustRemainRunnable !== undefined
    && typeof value.coreMustRemainRunnable !== 'boolean'
  ) return false;
  if (value.capabilityStates !== undefined) {
    const states = [
      'ready',
      'needs-authorization',
      'available-to-configure',
      'unavailable',
      'fallback',
    ];
    if (
      !isStringArray(value.capabilityStates)
      || !value.capabilityStates.every((state) => states.includes(state))
    ) return false;
  }
  return true;
}

function isAuthorization(value: unknown): boolean {
  return isRecord(value)
    && typeof value.type === 'string'
    && ['always', 'when-used', 'optional'].includes(String(value.required))
    && typeof value.description === 'string'
    && typeof value.fallback === 'string';
}

function isReliability(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.idempotency) || !isRecord(value.retry)) return false;
  if (!isRecord(value.humanEscalation)) return false;
  return typeof value.idempotency.scope === 'string'
    && isStringArray(value.idempotency.keyFields)
    && typeof value.retry.maxAttempts === 'number'
    && Number.isInteger(value.retry.maxAttempts)
    && value.retry.maxAttempts >= 1
    && isStringArray(value.retry.retryableClasses)
    && isStringArray(value.retry.nonRetryableClasses)
    && isStringArray(value.errorClasses)
    && isStringArray(value.evidenceRequired)
    && typeof value.humanEscalation.afterConsecutiveFailures === 'number'
    && Number.isInteger(value.humanEscalation.afterConsecutiveFailures)
    && value.humanEscalation.afterConsecutiveFailures >= 1
    && typeof value.humanEscalation.preserveArtifacts === 'boolean'
    && typeof value.humanEscalation.preserveLogs === 'boolean';
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
    value.engine !== undefined
    && value.engine !== 'codex'
    && value.engine !== 'native'
    && value.engine !== 'auto'
  ) {
    return false;
  }
  if (value.toolPolicy !== undefined && !isToolPolicy(value.toolPolicy)) return false;
  if (
    value.targetMaturity !== undefined
    && value.targetMaturity !== 'L2'
    && value.targetMaturity !== 'L3'
  ) {
    return false;
  }
  if (value.workspace !== undefined && !isWorkspaceRequirement(value.workspace)) return false;
  if (value.onboarding !== undefined && !isOnboarding(value.onboarding)) return false;
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
    value.authorizations !== undefined
    && (!Array.isArray(value.authorizations) || !value.authorizations.every(isAuthorization))
  ) return false;
  if (value.reliability !== undefined && !isReliability(value.reliability)) return false;
  if (
    value.sources !== undefined
    && (!Array.isArray(value.sources) || !value.sources.every(isSourceCapability))
  ) return false;
  return true;
}

export interface ContractIssue {
  code: string;
  message: string;
  /** Dotted path to the offending field, e.g. `runtime.budgets`. */
  path?: string;
}

/**
 * Result of the single mandatory contract gate. `ok === true` means the
 * package is conformant enough to be *listed on the platform / minted* —
 * i.e. it has no blocking errors. Warnings are advisory (maturity gaps a
 * maker should close but that don't block listing).
 */
export interface ContractValidation {
  ok: boolean;
  errors: ContractIssue[];
  warnings: ContractIssue[];
  audit: EmployeeAuditReport;
}

/**
 * The complete set of top-level keys the runtime contract defines. Any other
 * key in a shipped `runtime` block is contract drift — a field the platform
 * never consumes (verified: `capabilityPriority`/`entrySkill`/`budgets` have
 * zero readers in Fuyao src) yet that four packages each spelled differently.
 * A single enforced allowlist is what "single mandatory schema" means.
 */
const KNOWN_RUNTIME_KEYS: ReadonlySet<string> = new Set([
  'version', 'engine', 'toolPolicy', 'targetMaturity', 'workspace', 'onboarding', 'memory',
  'workflows', 'review', 'evolution', 'escalation', 'acceptance',
  'dependencies', 'authorizations', 'reliability', 'sources',
]);

// ponytail: substring blocklist, not an SPDX validator. It catches the
// concrete "license undecided" red flags an enterprise due-diligence pass
// treats as blocking; upgrade to an SPDX allowlist if makers start gaming it.
const UNRESOLVED_LICENSE_MARKERS = [
  'no license', 'not declared', 'absent', 'requires organization review',
  'placeholder', 'tbd', '未声明', '未确认', '占位', '待确认',
];

/**
 * Audit gap codes that block *listing*. Deliberately only the integrity
 * blockers (identity / agent / skill / runtime present). Maturity gaps
 * (missing review metrics, ungoverned evolution, thin escalation, no
 * acceptance cases, incomplete ledger) are surfaced as warnings that drive
 * the red/yellow/green wizard grade but never hard-block a listing — that
 * spectrum is what keeps the maker onboarding bar low while still flagging
 * what enterprise due-diligence actually rejects (drift, undecided license).
 */
const LISTING_BLOCKING_GAP_CODES: ReadonlySet<string> = new Set([
  'INVALID_MANIFEST', 'MISSING_AGENT', 'MISSING_AGENT_FILE',
  'MISSING_SKILLS', 'MISSING_SKILL_FILE', 'MISSING_RUNTIME_CONTRACT',
]);

/**
 * Single mandatory contract gate. Parses the raw plugin.json and returns a
 * pass/fail verdict the platform uses to decide whether a package may be
 * listed, and the minting wizard uses to render red/yellow/green.
 *
 * It layers three enforcements on top of the existing structural guard and
 * maturity audit, which were both permissive:
 *  1. no unknown top-level `runtime` keys (kills contract drift);
 *  2. every declared open-source `source` carries a *resolved* license;
 *  3. any blocking maturity gap (missing agent/skill/runtime) blocks listing.
 */
export function validatePackageContract(input: {
  pluginJson: string;
  files: string[];
  /**
   * Block packages whose open-source `sources` carry an undecided license.
   * Off by default: the founder deferred license-attestation gating on
   * 2026-07-13 (platform/market too early for that legal-risk step). Flip to
   * `true` to re-enable the UNRESOLVED_LICENSE gate — the detection logic is
   * kept live and tested so it's a one-flag switch when that day comes.
   */
  enforceLicense?: boolean;
}): ContractValidation {
  const errors: ContractIssue[] = [];
  const warnings: ContractIssue[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.pluginJson);
  } catch {
    const audit: EmployeeAuditReport = {
      level: 'L0', targetLevel: 'L3', score: 0,
      gaps: [], capabilityLedger: [],
    };
    errors.push({ code: 'INVALID_JSON', message: 'plugin.json 不是合法 JSON' });
    return { ok: false, errors, warnings, audit };
  }

  const manifest = isRecord(parsed) ? (parsed as EmployeePluginManifest) : null;
  const audit = auditEmployeePackage({ manifest, files: input.files });

  if (!manifest || !(manifest.agentName || manifest.name)) {
    errors.push({ code: 'INVALID_MANIFEST', message: '缺少可识别的 plugin.json 或员工标识' });
    return { ok: false, errors, warnings, audit };
  }

  const rawRuntime = (parsed as { runtime?: unknown }).runtime;
  // MISSING_RUNTIME_CONTRACT is emitted by auditEmployeePackage below (and
  // routed to errors via LISTING_BLOCKING_GAP_CODES) — don't double-count it.
  if (rawRuntime !== undefined && (!isRuntimeProfile(rawRuntime) || !isRecord(rawRuntime))) {
    errors.push({ code: 'MALFORMED_RUNTIME', message: 'runtime 结构不符合强制 schema' });
  } else if (rawRuntime !== undefined && isRecord(rawRuntime)) {
    for (const key of Object.keys(rawRuntime)) {
      if (!KNOWN_RUNTIME_KEYS.has(key)) {
        errors.push({
          code: 'UNKNOWN_RUNTIME_KEY',
          message: `runtime 含未定义字段（契约漂移）：${key}`,
          path: `runtime.${key}`,
        });
      }
    }
    if (input.enforceLicense && Array.isArray(rawRuntime.sources)) {
      for (const source of rawRuntime.sources as EmployeeSourceCapability[]) {
        const lic = (source.license ?? '').toLowerCase();
        if (!lic.trim() || UNRESOLVED_LICENSE_MARKERS.some((m) => lic.includes(m))) {
          errors.push({
            code: 'UNRESOLVED_LICENSE',
            message: `开源来源许可证未决，需 maker 确认权利：${source.name}`,
            path: `runtime.sources.${source.name}`,
          });
        }
      }
    }
  }

  for (const gap of audit.gaps) {
    const target = LISTING_BLOCKING_GAP_CODES.has(gap.code) ? errors : warnings;
    target.push({ code: gap.code, message: gap.message });
  }

  return { ok: errors.length === 0, errors, warnings, audit };
}

/** Provider id for an employee's dedicated (modelConfig-injected) provider. */
export function employeeProviderId(agentName: string): string {
  return `employee:${agentName}`;
}

/**
 * Structural guard for a maker-supplied modelConfig. A malformed config (e.g.
 * `{}` with no `provider`) must never be dereferenced (`.provider.apiKey`) —
 * callers should skip injection and record a non-blocking gap instead of
 * crashing. apiKey/imageGen stay optional and unchecked here.
 */
export function isValidEmployeeModelConfig(value: unknown): value is EmployeeModelConfig {
  if (!isRecord(value) || !isRecord(value.provider)) return false;
  const p = value.provider;
  if (p.apiFormat !== 'anthropic' && p.apiFormat !== 'openai-compatible') return false;
  if (typeof p.baseUrl !== 'string' || p.baseUrl.trim() === '') return false;
  if (typeof p.model !== 'string' || p.model.trim() === '') return false;
  return true;
}

export function parseEmployeePlugin(raw: string): EmployeePluginManifest | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const manifest = { ...parsed } as EmployeePluginManifest;
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
