/**
 * Project Rules — user-maintained project rules (FUYAO.md)
 *
 * Rules are manually maintained by users (committed to git, high priority).
 * This is separate from AI-written memories (.abu/MEMORY.md).
 *
 * File structure:
 *   ~/.uprow/FUYAO.md                — User-level rules (cross-project)
 *   {workspace}/.abu/FUYAO.md        — Project main rules
 *   {workspace}/.abu/rules/*.md      — Modular rules (alphabetical)
 *
 * Backward compat: workspaces/homes created before the Fuyao rebrand hold
 * ABU.md instead — readers fall back to it, writers only create FUYAO.md.
 */

import { readTextFile, readDir, exists, mkdir } from '@tauri-apps/plugin-fs';
import { DATA_DIR_NAME, RULES_FILENAME, LEGACY_RULES_FILENAME, WORKSPACE_DIR_NAME } from '@/core/branding';
import { homeDir } from '@tauri-apps/api/path';
import { joinPath } from '../../utils/pathUtils';
import { writeTextFile } from '@tauri-apps/plugin-fs';

const MAX_USER_RULES_CHARS = 4000;
const MAX_PROJECT_RULES_CHARS = 8000;
const MAX_RULE_FILES = 20;

/**
 * Truncate content at a paragraph boundary to avoid breaking markdown structure.
 */
function truncateAtParagraph(content: string, maxChars: number, suffix: string): string {
  if (content.length <= maxChars) return content;
  const cutPoint = content.lastIndexOf('\n\n', maxChars);
  const effectiveCut = cutPoint > maxChars * 0.5 ? cutPoint : maxChars;
  return content.slice(0, effectiveCut) + '\n' + suffix;
}

// Cache homeDir to avoid repeated IPC calls
let cachedHomeDir: string | null = null;

async function getCachedHomeDir(): Promise<string> {
  if (!cachedHomeDir) {
    cachedHomeDir = await homeDir();
  }
  return cachedHomeDir;
}

/**
 * Read a text file safely, returning empty string on error.
 */
async function safeReadTextFile(path: string): Promise<string> {
  try {
    return await readTextFile(path);
  } catch {
    return '';
  }
}

/**
 * Read the rules file from a dot dir: FUYAO.md first, falling back to the
 * pre-rebrand ABU.md when FUYAO.md is absent/empty.
 */
async function readRulesFile(dotDir: string): Promise<string> {
  const content = await safeReadTextFile(joinPath(dotDir, RULES_FILENAME));
  if (content) return content;
  return await safeReadTextFile(joinPath(dotDir, LEGACY_RULES_FILENAME));
}

/**
 * Load user-level rules from ~/.uprow/FUYAO.md (legacy ABU.md fallback)
 */
export async function loadUserRules(): Promise<string> {
  const home = await getCachedHomeDir();
  const content = await readRulesFile(joinPath(home, DATA_DIR_NAME));
  if (!content) return '';
  return truncateAtParagraph(content, MAX_USER_RULES_CHARS, '...(用户规则已截断)');
}

/**
 * Load project main rules from {workspace}/.abu/FUYAO.md (legacy ABU.md fallback)
 */
export async function loadProjectRules(workspacePath: string): Promise<string> {
  return await readRulesFile(joinPath(workspacePath, WORKSPACE_DIR_NAME));
}

/**
 * Load modular rules from {workspace}/.abu/rules/*.md
 * Files are sorted alphabetically, max MAX_RULE_FILES files.
 * Each file is prefixed with "### {filename}" header.
 */
export async function loadModularRules(workspacePath: string): Promise<string> {
  const rulesDir = joinPath(workspacePath, WORKSPACE_DIR_NAME, 'rules');
  try {
    if (!(await exists(rulesDir))) return '';
    const entries = await readDir(rulesDir);
    const mdFiles = entries
      .filter(e => !e.isDirectory && e.name.endsWith('.md'))
      .map(e => e.name)
      .sort()
      .slice(0, MAX_RULE_FILES);

    if (mdFiles.length === 0) return '';

    const parts: string[] = [];
    for (const fileName of mdFiles) {
      const filePath = joinPath(rulesDir, fileName);
      const content = await safeReadTextFile(filePath);
      if (content.trim()) {
        parts.push(`### ${fileName}\n${content.trim()}`);
      }
    }
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Load all rules by priority (low → high):
 * 1. User-level rules (~/.uprow/FUYAO.md)
 * 2. Project main rules ({workspace}/.abu/FUYAO.md)
 * 3. Modular rules ({workspace}/.abu/rules/*.md)
 *
 * Total budget: MAX_USER_RULES_CHARS + MAX_PROJECT_RULES_CHARS
 */
export async function loadAllRules(workspacePath: string | null): Promise<string> {
  const parts: string[] = [];

  // 1. User-level rules
  try {
    const userRules = await loadUserRules();
    if (userRules.trim()) {
      parts.push(`### 用户规则（~/.uprow/${RULES_FILENAME}）\n${userRules.trim()}`);
    }
  } catch (err) {
    console.warn('Failed to load user rules:', err);
  }

  // 2 & 3. Project rules (main + modular)
  if (workspacePath) {
    try {
      const projectRules = await loadProjectRules(workspacePath);
      if (projectRules.trim()) {
        parts.push(`### 项目规则（.abu/${RULES_FILENAME}）\n${projectRules.trim()}`);
      }
    } catch (err) {
      console.warn('Failed to load project rules:', err);
    }

    try {
      const modularRules = await loadModularRules(workspacePath);
      if (modularRules.trim()) {
        parts.push(`### 模块化规则（.abu/rules/）\n${modularRules.trim()}`);
      }
    } catch (err) {
      console.warn('Failed to load modular rules:', err);
    }
  }

  if (parts.length === 0) return '';

  let result = parts.join('\n\n');

  // Enforce total budget
  const totalBudget = MAX_USER_RULES_CHARS + MAX_PROJECT_RULES_CHARS;
  result = truncateAtParagraph(result, totalBudget, '...(规则已截断，请精简规则内容)');

  return result;
}

/** Absolute path where workspace rules are written ({workspace}/.abu/FUYAO.md). */
export function workspaceRulesWritePath(workspacePath: string): string {
  return joinPath(workspacePath, WORKSPACE_DIR_NAME, RULES_FILENAME);
}

/**
 * Find the existing workspace rules file: FUYAO.md preferred, legacy ABU.md
 * fallback. Returns null when neither exists. UI components use this so the
 * panel badge/editor reflect whichever file is actually in effect.
 */
export async function findWorkspaceRulesFile(
  workspacePath: string,
): Promise<{ path: string; fileName: string } | null> {
  const dotDir = joinPath(workspacePath, WORKSPACE_DIR_NAME);
  const current = joinPath(dotDir, RULES_FILENAME);
  if (await exists(current)) return { path: current, fileName: RULES_FILENAME };
  const legacy = joinPath(dotDir, LEGACY_RULES_FILENAME);
  if (await exists(legacy)) return { path: legacy, fileName: LEGACY_RULES_FILENAME };
  return null;
}

/**
 * Initialize workspace rules: create template .abu/FUYAO.md and .abu/rules/ directory.
 * Returns a description of what was created.
 */
export async function initWorkspaceRules(workspacePath: string): Promise<string> {
  const dotDir = joinPath(workspacePath, WORKSPACE_DIR_NAME);
  const rulesFile = joinPath(dotDir, RULES_FILENAME);
  const legacyRulesFile = joinPath(dotDir, LEGACY_RULES_FILENAME);
  const rulesDir = joinPath(dotDir, 'rules');
  const results: string[] = [];

  // A rules file under either name counts as "already initialized".
  if (await exists(rulesFile)) {
    return `\`.abu/${RULES_FILENAME}\` 已存在，请直接编辑或使用 /init 技能让 AI 帮助改进。`;
  }
  if (await exists(legacyRulesFile)) {
    return `\`.abu/${LEGACY_RULES_FILENAME}\` 已存在（旧版规则文件，仍然生效），请直接编辑或使用 /init 技能让 AI 帮助改进。`;
  }

  // Ensure the workspace dot directory exists
  try {
    if (!(await exists(dotDir))) {
      await mkdir(dotDir, { recursive: true });
    }
  } catch (err) {
    console.warn('Failed to create workspace dot directory:', err);
  }

  // Create template FUYAO.md
  const template = `# 项目规则

<!--
  这是项目规则文件，由团队成员手动维护。
  扶摇会在每次对话中加载这些规则并严格遵守。
  建议提交到 git，与团队共享。

  注意：.abu/MEMORY.md 是 AI 自动记忆，不要提交到 git。
-->

## 项目概述
<!-- 简述项目名称、用途 -->

## 技术栈
<!-- 列出主要技术栈 -->

## 编码规范
<!-- 编码风格、命名约定等 -->

## 构建与运行
<!-- 常用命令 -->

## 其他约定
<!-- 团队特定的约定 -->
`;

  try {
    await writeTextFile(rulesFile, template);
    results.push(`创建了 \`.abu/${RULES_FILENAME}\` 规则模板`);
  } catch (err) {
    results.push(`创建 ${RULES_FILENAME} 失败: ${err}`);
  }

  // Create rules directory
  try {
    if (!(await exists(rulesDir))) {
      await mkdir(rulesDir, { recursive: true });
      results.push('创建了 `.abu/rules/` 目录');
    }
  } catch (err) {
    results.push(`创建 rules 目录失败: ${err}`);
  }

  return results.join('\n');
}
