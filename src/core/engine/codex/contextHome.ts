// ─────────────────────────────────────────────────────────────────────────────
// project06 M1 · Codex 引擎 · ContextHome 构建器（纯逻辑层）
//
// Ports the PoC proven on real hardware (project06 evidence 2026-07-12) into
// Fuyao. Given a loaded employee (persona + skills), it produces the two text
// artifacts the Codex engine consumes:
//   - AGENTS.md   — Codex's native project-instructions file (persona + skills)
//   - config.toml — model provider + [skills] block
//
// This mirrors ChaWork's `context_builder.rs` (build_employee_section +
// write_config_toml), but the "employee format" here is deliberately engine-
// agnostic: whatever the loader hands us (Fuyao `agents/*.md` OR ChaWork
// `prompt.md`) reduces to `personaMarkdown`. That is the P0-0 "adopt the common
// substrate (AGENTS.md + SKILL.md)" decision, in code.
//
// PURE by design: no filesystem, no Tauri, no process — just string assembly, so
// it is fully unit-testable. The fs-writing wrapper (Tauri plugin-fs) and the
// codex-sdk sidecar driver are the next M1 increments.
// ─────────────────────────────────────────────────────────────────────────────

/** One skill's inputs for AGENTS.md assembly (basename + SKILL.md metadata + body). */
export interface ContextHomeSkill {
  /** Skill folder id (basename). */
  id: string;
  /** `name:` from SKILL.md frontmatter (falls back to id upstream). */
  name: string;
  /** `description:` from SKILL.md frontmatter. */
  description: string;
  /** Full SKILL.md text (frontmatter is stripped before inlining). */
  body: string;
}

export interface ContextHomeInput {
  /** Display name of the employee (from plugin.json name / employee.yaml name). */
  employeeName: string;
  /** The persona/instructions markdown (Fuyao agents/*.md body OR ChaWork prompt.md). */
  personaMarkdown: string;
  /** Enabled skills. */
  skills: ContextHomeSkill[];
}

/** Optional model-provider config for config.toml. Defaults to OpenAI (codex login / OPENAI_API_KEY). */
export interface CodexProviderConfig {
  /** e.g. "gpt-5"; omit to use codex's default model. */
  model?: string;
  /** Custom OpenAI-compatible provider; omit to use codex's built-in `openai`. */
  provider?: {
    /** id used as `model_provider` and `[model_providers.<id>]`. */
    id: string;
    /** Human label. */
    name: string;
    /** OpenAI-compatible base URL. */
    baseUrl: string;
    /** Env var codex reads the key from (sent as Bearer). */
    envKey: string;
    /**
     * Wire protocol. NOTE: recent codex REMOVED "chat"; only "responses" is
     * accepted. So chat-completions-only endpoints (e.g. DeepSeek direct) are
     * unsupported — use a Responses-compatible provider (OpenAI, DashScope).
     */
    wireApi?: 'responses';
    /** DashScope-style Responses compat lacks websocket transport → set false. */
    supportsWebsockets?: boolean;
  };
}

/** Strip a leading YAML frontmatter block (`---\n...\n---`) from markdown. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

/**
 * Build the AGENTS.md that Codex reads as project instructions.
 * Structure matches the real-hardware-proven PoC exactly:
 *   # <name> → ## 员工身份与指令(persona) → ## 可用技能(list + inlined bodies) → ## 运行约定
 */
export function buildAgentsMarkdown(input: ContextHomeInput): string {
  const persona = input.personaMarkdown.trim();
  const skillList = input.skills.length > 0
    ? input.skills.map((s) => `- **${s.name}** — ${s.description}`).join('\n')
    : '（无）';
  const skillBodies = input.skills
    .map((s) => `\n### 技能：${s.name}\n\n${stripFrontmatter(s.body).trim()}`)
    .join('\n');

  return [
    `# ${input.employeeName}`,
    '',
    `你现在扮演数字员工「**${input.employeeName}**」。以下是你的核心指令，优先级高于任何通用助手说明。`,
    '',
    '---',
    '',
    '## 员工身份与指令',
    '',
    persona,
    '',
    '---',
    '',
    '## 可用技能',
    '',
    skillList,
    skillBodies,
    '',
    '---',
    '',
    '## 运行约定',
    '- 当前目录是用户授权的工作区，可读写其中文件。',
    '- 只依据工作区内的真实数据，不编造。',
    '- 完成后把交付物写成文件留在工作区。',
    '',
  ].join('\n');
}

/**
 * Build config.toml for the Codex engine. Default = OpenAI (no provider block,
 * codex uses its built-in openai provider via `codex login` or OPENAI_API_KEY).
 * Pass `provider` for a custom OpenAI-compatible endpoint (DashScope, etc.).
 */
export function buildCodexConfigToml(cfg: CodexProviderConfig = {}): string {
  const lines: string[] = [
    '# project06 · Codex 引擎配置（Fuyao 生成）',
  ];
  if (cfg.model) lines.push(`model = "${cfg.model}"`);
  if (cfg.provider) {
    const p = cfg.provider;
    lines.push(`model_provider = "${p.id}"`, '');
    lines.push(`[model_providers.${p.id}]`);
    lines.push(`name = "${p.name}"`);
    lines.push(`base_url = "${p.baseUrl}"`);
    lines.push(`env_key = "${p.envKey}"`);
    lines.push(`wire_api = "${p.wireApi ?? 'responses'}"`);
    if (p.supportsWebsockets === false) lines.push('supports_websockets = false');
  }
  lines.push('', '[skills]', 'include_instructions = true', '');
  return lines.join('\n');
}
