import { parse as parseYaml } from 'yaml';
import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs';
import type { SubagentDefinition } from '../../types';
import { joinPath, normalizeSeparators } from '../../utils/pathUtils';

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

/** Multilingual string pair used throughout plugin.json. */
interface LocalePair {
  zh?: string;
  en?: string;
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
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as CodebuddyPluginJson;
  } catch {
    return null;
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
    return null; // not a CodeBuddy package
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

  const displayNames =
    plugin.displayName?.zh || plugin.displayName?.en
      ? {
          ...(plugin.displayName?.zh ? { 'zh-CN': plugin.displayName.zh } : {}),
          ...(plugin.displayName?.en ? { 'en-US': plugin.displayName.en } : {}),
        }
      : undefined;

  const profession = pickZhFirst(plugin.profession);
  const professionI18n =
    plugin.profession?.zh || plugin.profession?.en
      ? {
          ...(plugin.profession?.zh ? { 'zh-CN': plugin.profession.zh } : {}),
          ...(plugin.profession?.en ? { 'en-US': plugin.profession.en } : {}),
        }
      : undefined;

  const tags = plugin.tags
    ?.map((t) => pickZhFirst(t))
    .filter((s): s is string => Boolean(s));
  const tagsEn = plugin.tags
    ?.map((t) => t.en)
    .filter((s): s is string => Boolean(s));
  const tagsI18n = tagsEn && tagsEn.length > 0 ? { 'en-US': tagsEn } : undefined;

  // Sample prompts: prefer quickPrompts, fall back to defaultInitPrompt.
  const promptPairs =
    plugin.quickPrompts && plugin.quickPrompts.length > 0
      ? plugin.quickPrompts
      : plugin.defaultInitPrompt
        ? [plugin.defaultInitPrompt]
        : [];
  const samplePrompts = promptPairs
    .map((q) => pickZhFirst(q))
    .filter((s): s is string => Boolean(s));
  const samplePromptsEn = promptPairs
    .map((q) => q.en)
    .filter((s): s is string => Boolean(s));
  const samplePromptsI18n =
    samplePromptsEn.length > 0 ? { 'en-US': samplePromptsEn } : undefined;

  // Skill directory names (basename of each "./skills/x") — captured for Phase B
  // skill wiring; the registry doesn't resolve them yet.
  const skills = plugin.skills
    ?.map((s) => stripLeadingDot(s).split('/').filter(Boolean).pop())
    .filter((s): s is string => Boolean(s));

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
    memory: 'session',
    source: 'employee',
    systemPrompt,
    filePath: pluginPath,
  };
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
