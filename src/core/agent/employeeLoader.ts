import { parse as parseYaml } from 'yaml';
import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs';
import type { EmployeeDreamConfig, SubagentDefinition } from '../../types';
import { joinPath, normalizeSeparators } from '../../utils/pathUtils';
import {
  employeeProviderId,
  isValidEmployeeModelConfig,
  parseEmployeePlugin,
  type EmployeeModelConfig,
  type EmployeeRuntimeProfile,
  type LocalePair,
} from '@/core/employee/contract';
import type { EmployeeRuntimeSetupRequest } from '@/stores/deepLinkStore';

/**
 * Employee Loader — load WorkBuddy / CodeBuddy "expert" packages into Abu's
 * agent registry so they behave exactly like the built-in personas
 * (@mention routing, AgentSelector dropdown, per-agent memory).
 *
 * Package layout (under ~/.uprow/employees/<pkg>/):
 *   .codebuddy-plugin/plugin.json   — multilingual metadata
 *   agents/<agentName>.md           — YAML frontmatter + system-prompt body
 *   skills/<skill>/SKILL.md         — supporting skills (loaded by SkillLoader)
 *   avatars/<file>.png              — avatar image
 *
 * We read plugin.json at runtime (no on-disk conversion to AGENT.md) so package
 * updates take effect on the next discovery pass.
 */

/** Build a { 'zh-CN': ..., 'en-US': ... } map from a LocalePair; returns undefined when both are absent. */
function toLocaleMap(pair: LocalePair | undefined): Record<string, string> | undefined {
  if (!pair?.zh && !pair?.en) return undefined;
  return {
    ...(pair.zh ? { 'zh-CN': pair.zh } : {}),
    ...(pair.en ? { 'en-US': pair.en } : {}),
  };
}

/** Split a LocalePair[] into parallel zh and en string arrays, skipping absent entries. */
function splitLocalePairs(pairs: LocalePair[]): { zh: string[]; en: string[] } {
  return {
    zh: pairs.map((p) => p.zh).filter((s): s is string => Boolean(s)),
    en: pairs.map((p) => p.en).filter((s): s is string => Boolean(s)),
  };
}

/** Subset of `.codebuddy-plugin/plugin.json` that we map into a SubagentDefinition. */
interface CodebuddyPluginJson {
  name?: string;
  agentName?: string;
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

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

/**
 * Heuristic: does this avatar string point to an image file (vs. an emoji)?
 * Image avatars carry a path separator or an image extension; emoji do not.
 */
export function isImageAvatarPath(avatar: string | undefined): boolean {
  if (!avatar) return false;
  return IMAGE_EXT_RE.test(avatar) || avatar.includes('/') || avatar.includes('\\');
}

/** Parse plugin.json text. Returns null on malformed JSON or non-object root. */
export function parsePluginJson(raw: string): CodebuddyPluginJson | null {
  return parseEmployeePlugin(raw) as CodebuddyPluginJson | null;
}

export function parseEmployeeDreamConfig(raw: string): EmployeeDreamConfig | null {
  try {
    const value = parseYaml(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const config = value as Record<string, unknown>;
    if (typeof config.enabled !== 'boolean') return null;

    let schedule: EmployeeDreamConfig['schedule'];
    let chaWorkFormat = false;
    if (config.schedule === 'daily' || config.schedule === 'manual') {
      schedule = config.schedule;
    } else if (config.schedule && typeof config.schedule === 'object' && !Array.isArray(config.schedule)) {
      chaWorkFormat = true;
      const scheduleConfig = config.schedule as Record<string, unknown>;
      if (scheduleConfig.type !== 'daily' && scheduleConfig.type !== 'manual') return null;
      if (
        scheduleConfig.time !== undefined
        && (typeof scheduleConfig.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduleConfig.time))
      ) return null;
      schedule = scheduleConfig.type;
    } else {
      return null;
    }

    const rawScan = config.session_scan;
    if (rawScan !== undefined && (!rawScan || typeof rawScan !== 'object' || Array.isArray(rawScan))) {
      return null;
    }
    const scan = rawScan as Record<string, unknown> | undefined;
    if (chaWorkFormat) {
      if (scan?.scope !== undefined && scan.scope !== 'all' && scan.scope !== 'selected') return null;
      if (
        scan?.workspace_subset !== undefined
        && (!Array.isArray(scan.workspace_subset) || !scan.workspace_subset.every((item) => typeof item === 'string'))
      ) return null;
    } else if (scan?.scope !== undefined && scan.scope !== 'employee') {
      return null;
    }
    const maxSessions = Number((chaWorkFormat ? scan?.latest_sessions : scan?.max_sessions) ?? 5);
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 20) return null;
    return {
      enabled: config.enabled,
      schedule,
      sessionScan: { maxSessions },
    };
  } catch {
    return null;
  }
}

async function loadEmployeeDreamConfig(pkgDir: string): Promise<EmployeeDreamConfig | undefined> {
  try {
    const parsed = parseEmployeeDreamConfig(await readTextFile(joinPath(pkgDir, 'dream.yaml')));
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}

/** zh-first localized pick (Abu's default locale is zh-CN). */
function pickZhFirst(pair: LocalePair | undefined): string | undefined {
  if (!pair) return undefined;
  return pair.zh ?? pair.en ?? undefined;
}

/** Strip leading "./" or "/" so relative package paths join cleanly. */
function stripLeadingDot(p: string): string {
  return p.replace(/^\.?\//, '');
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0
    && value === value.trim()
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0');
}

/** Split a markdown file into YAML frontmatter + body. Body is the system prompt. */
function splitFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };
  try {
    const meta = (parseYaml(match[1]) as Record<string, unknown>) ?? {};
    return { meta, body: match[2].trim() };
  } catch {
    return { meta: {}, body: match[2]?.trim() ?? raw.trim() };
  }
}

/**
 * Load a single employee package directory into a SubagentDefinition.
 * Returns null if the package has no readable plugin.json / agent file.
 */
export async function loadEmployeePackage(pkgDir: string): Promise<SubagentDefinition | null> {
  const pluginPath = joinPath(pkgDir, '.codebuddy-plugin/plugin.json');
  let rawPlugin: string;
  try {
    rawPlugin = await readTextFile(pluginPath);
  } catch {
    // No plugin.json → try the ChaWork format (employee.yaml + prompt.md + skills).
    // Both formats reduce to the same substrate (project06 P0-0); dual-manifest
    // detection is automatic, not a lossy conversion.
    return loadChaWorkEmployee(pkgDir);
  }

  const plugin = parsePluginJson(rawPlugin);
  if (!plugin) return null;

  // Canonical name = @mention token + registry key. Prefer the stable slug.
  const name = plugin.agentName || plugin.name;
  if (!name) return null;

  // Resolve the system prompt from the first declared agent markdown file.
  const agentRel = plugin.agents?.[0];
  let systemPrompt = '';
  let frontmatterEmoji: string | undefined;
  if (agentRel) {
    const agentPath = joinPath(pkgDir, stripLeadingDot(agentRel));
    try {
      const rawAgent = await readTextFile(agentPath);
      const { meta, body } = splitFrontmatter(rawAgent);
      systemPrompt = body;
      if (typeof meta.emoji === 'string') frontmatterEmoji = meta.emoji;
    } catch {
      // Missing agent file — keep an empty prompt rather than dropping the employee.
    }
  }

  // Avatar: image path (resolved absolute, normalized) takes priority, else the
  // agent-markdown emoji. The UI decides image vs. emoji via isImageAvatarPath().
  let avatar: string | undefined = frontmatterEmoji;
  if (plugin.avatar) {
    avatar = normalizeSeparators(joinPath(pkgDir, stripLeadingDot(plugin.avatar)));
  }

  // Description: zh is the default-locale value; en goes into the override map.
  const description = pickZhFirst(plugin.displayDescription) ?? plugin.description ?? '';
  const descriptions = plugin.displayDescription?.en
    ? { 'en-US': plugin.displayDescription.en }
    : undefined;

  const displayNames = toLocaleMap(plugin.displayName);
  const profession = pickZhFirst(plugin.profession);
  const professionI18n = toLocaleMap(plugin.profession);

  const { zh: tags, en: tagsEn } = splitLocalePairs(plugin.tags ?? []);
  const tagsI18n = tagsEn.length > 0 ? { 'en-US': tagsEn } : undefined;

  // Sample prompts: prefer quickPrompts, fall back to defaultInitPrompt.
  const promptPairs =
    plugin.quickPrompts && plugin.quickPrompts.length > 0
      ? plugin.quickPrompts
      : plugin.defaultInitPrompt
        ? [plugin.defaultInitPrompt]
        : [];
  const { zh: samplePrompts, en: samplePromptsEn } = splitLocalePairs(promptPairs);
  const samplePromptsI18n = samplePromptsEn.length > 0 ? { 'en-US': samplePromptsEn } : undefined;

  // Skill directory names (basename of each "./skills/x") — captured for Phase B
  // skill wiring; the registry doesn't resolve them yet.
  const skills = plugin.skills
    ?.map((s) => stripLeadingDot(s).split('/').filter(Boolean).pop())
    .filter((s): s is string => Boolean(s));
  const dream = await loadEmployeeDreamConfig(pkgDir);

  return {
    name,
    description,
    descriptions,
    avatar,
    displayNames,
    profession,
    professionI18n,
    tags: tags && tags.length > 0 ? tags : undefined,
    tagsI18n,
    samplePrompts: samplePrompts.length > 0 ? samplePrompts : undefined,
    samplePromptsI18n,
    category: plugin.categoryId,
    skills: skills && skills.length > 0 ? skills : undefined,
    memory: plugin.runtime?.memory?.scope ?? 'session',
    memoryAutoCapture: plugin.runtime?.memory?.autoCapture,
    memoryWrites: plugin.runtime?.evolution?.memoryWrites,
    dream,
    source: 'employee',
    toolPolicy: plugin.runtime?.toolPolicy,
    // Engine routing (project06 M1): existing packages omit runtime.engine →
    // 'native', so the built-in loop keeps running them (regression-safe).
    engine: plugin.runtime?.engine ?? 'native',
    // Maker-pinned model: conversations with this employee run on its
    // dedicated provider (registered at install time from modelConfig).
    ...(isValidEmployeeModelConfig(plugin.modelConfig)
      ? { model: plugin.modelConfig.provider.model, providerId: employeeProviderId(name) }
      : {}),
    systemPrompt,
    filePath: pluginPath,
  };
}

/** ChaWork-format identity manifest (`employee.yaml`). Engine-agnostic — no
 *  profession/vertical fields (project06 P0-0 finding). */
interface ChaWorkEmployeeYaml {
  id?: string;
  name?: string;
  description?: string;
  kind?: string;
  status?: string;
}

/** Parse the installed ChaWork skills registry. Invalid registries fail closed. */
export function parseChaWorkSkillRegistry(raw: string): string[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const skills = (value as Record<string, unknown>).skills;
    if (!Array.isArray(skills)) return null;

    const enabled = new Set<string>();
    for (const item of skills) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== 'string' || !isSafePathSegment(entry.id) || typeof entry.enabled !== 'boolean') {
        return null;
      }
      if (entry.enabled) enabled.add(entry.id);
    }
    return [...enabled];
  } catch {
    return null;
  }
}

/**
 * Build a SubagentDefinition from ChaWork-format package parts. PURE (no fs) so
 * it is unit-testable. ChaWork carries identity in employee.yaml, persona in
 * prompt.md, and capabilities in skills/-slash-SKILL.md — the same open substrate
 * our plugin.json packages reduce to. It runs on the existing native substrate;
 * origin format never selects an execution engine.
 * Returns null on unparseable yaml or a manifest with no id/name.
 */
export function buildChaWorkSubagent(
  rawYaml: string,
  promptMd: string,
  skillNames: string[],
): SubagentDefinition | null {
  let manifest: ChaWorkEmployeeYaml | null;
  try {
    manifest = parseYaml(rawYaml) as ChaWorkEmployeeYaml | null;
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  if (manifest.status !== undefined && typeof manifest.status !== 'string') return null;
  if (manifest.status === 'archived') return null;
  // Canonical @mention key prefers the stable slug (id), like plugin.json's agentName.
  const name = typeof manifest.id === 'string'
    ? manifest.id
    : typeof manifest.name === 'string'
      ? manifest.name
      : '';
  if (!isSafePathSegment(name) || name === 'abu' || name === '__dream__') return null;
  const displayName = typeof manifest.name === 'string' ? manifest.name : undefined;
  const description = typeof manifest.description === 'string' ? manifest.description : '';
  const skills = [...new Set(skillNames.filter(isSafePathSegment))];
  return {
    name,
    description,
    ...(displayName && displayName !== name
      ? { displayNames: { 'zh-CN': displayName } }
      : {}),
    skills: skills.length > 0 ? skills : undefined,
    memory: 'project',
    source: 'employee',
    engine: 'native',
    systemPrompt: promptMd.trim(),
    filePath: '', // set by the fs wrapper below
  };
}

/**
 * Load a ChaWork-format package (employee.yaml + prompt.md + skills/) from disk.
 * Called as the fallback when a directory has no `.codebuddy-plugin/plugin.json`.
 * Returns null when it is not a ChaWork package either.
 */
export async function loadChaWorkEmployee(pkgDir: string): Promise<SubagentDefinition | null> {
  const yamlPath = joinPath(pkgDir, 'employee.yaml');
  let rawYaml: string;
  try {
    rawYaml = await readTextFile(yamlPath);
  } catch {
    return null;
  }
  let promptMd = '';
  try {
    promptMd = await readTextFile(joinPath(pkgDir, 'prompt.md'));
  } catch {
    // persona optional — keep empty
  }
  let skillNames: string[] = [];
  try {
    const entries = await readDir(joinPath(pkgDir, 'skills'));
    skillNames = entries
      .filter((entry) => entry.isDirectory && isSafePathSegment(entry.name))
      .map((entry) => entry.name);
  } catch {
    // no skills dir
  }
  try {
    const enabled = parseChaWorkSkillRegistry(await readTextFile(joinPath(pkgDir, 'skills.json')));
    const available = new Set(skillNames);
    skillNames = (enabled ?? []).filter((name) => available.has(name));
  } catch {
    // Legacy portable packages without skills.json keep all on-disk skills.
  }
  const def = buildChaWorkSubagent(rawYaml, promptMd, skillNames);
  if (def) {
    def.filePath = yamlPath;
    def.dream = await loadEmployeeDreamConfig(pkgDir);
    if (def.dream?.enabled) {
      def.memoryAutoCapture = ['preference', 'feedback', 'failure', 'project', 'reference'];
      def.memoryWrites = 'approval';
    }
  }
  return def;
}

/**
 * Scan an employees root directory (e.g. ~/.uprow/employees/) and load every
 * sub-directory that is a valid CodeBuddy package. Non-package directories are
 * skipped silently. Returns [] when the root doesn't exist.
 */
export async function scanEmployees(rootDir: string): Promise<SubagentDefinition[]> {
  const result: SubagentDefinition[] = [];
  try {
    if (!(await exists(rootDir))) return result;
    const entries = await readDir(rootDir);
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const pkg = await loadEmployeePackage(joinPath(rootDir, entry.name));
      if (pkg) result.push(pkg);
    }
  } catch {
    // Root unreadable — treat as no employees.
  }
  return result;
}

/**
 * Build a workspace-setup request for an already-installed employee when a NEW
 * conversation is started with it. Mirrors the deep-link install path (which
 * triggers EmployeeRuntimeSetupDialog): employees that declare a required
 * workspace must have one selected, otherwise their bundled skills never enter
 * the SkillLoader index (loader gates them per active agent + workspace) and the
 * model falls back to built-in skills.
 *
 * Re-reads the employee's plugin.json (via the agent's stored filePath) so the
 * full runtime profile / workflows / dependencies are available to the dialog.
 * Returns null when the agent is not an employee, has no parseable plugin, or
 * does not declare a required workspace — callers then proceed normally.
 */
export async function buildEmployeeWorkspaceSetup(
  agent: SubagentDefinition,
): Promise<EmployeeRuntimeSetupRequest | null> {
  if (agent.source !== 'employee' || !agent.filePath) return null;
  let rawPlugin: string;
  try {
    rawPlugin = await readTextFile(agent.filePath);
  } catch {
    return null;
  }
  const plugin = parsePluginJson(rawPlugin);
  if (!plugin) return null;
  const runtime = plugin.runtime;
  if (!runtime || runtime.workspace?.required !== true) return null;
  return {
    name: agent.name,
    packageId: plugin.name ?? agent.name,
    packageVersion: (plugin as { version?: string }).version,
    defaultInitPrompt: plugin.defaultInitPrompt,
    level: runtime.targetMaturity ?? 'L1',
    profile: runtime,
  };
}
