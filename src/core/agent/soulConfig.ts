/**
 * Soul Config — Abu's personality definition (SOUL.md)
 *
 * SOUL.md defines Abu's character traits and communication style.
 * File location: ~/.abu/SOUL.md
 *
 * Three editing channels:
 *   1. Settings UI (SoulSection)
 *   2. Direct file editing (~/.abu/SOUL.md)
 *   3. In-conversation via update_soul tool
 *
 * All writes go through saveSoul() as the single entry point.
 */

import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import { joinPath } from '../../utils/pathUtils';

const MAX_SOUL_CHARS = 2000;

// Cache homeDir to avoid repeated IPC calls
let cachedHomeDir: string | null = null;

async function getCachedHomeDir(): Promise<string> {
  if (!cachedHomeDir) {
    cachedHomeDir = await homeDir();
  }
  return cachedHomeDir;
}

/**
 * Get the path to ~/.abu/SOUL.md
 */
async function getSoulPath(): Promise<string> {
  const home = await getCachedHomeDir();
  return joinPath(home, '.abu', 'SOUL.md');
}

/**
 * Truncate content at a paragraph boundary to preserve markdown structure.
 */
function truncateAtParagraph(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const cutPoint = content.lastIndexOf('\n\n', maxChars);
  const effectiveCut = cutPoint > maxChars * 0.5 ? cutPoint : maxChars;
  return content.slice(0, effectiveCut) + '\n...(性格设定已截断，请精简内容)';
}

/**
 * Load Abu's soul from ~/.abu/SOUL.md.
 * Returns empty string if file doesn't exist or can't be read.
 */
export async function loadSoul(): Promise<string> {
  try {
    const soulPath = await getSoulPath();
    const content = await readTextFile(soulPath);
    if (!content.trim()) return '';
    return truncateAtParagraph(content.trim(), MAX_SOUL_CHARS);
  } catch {
    return '';
  }
}

/**
 * Save Abu's soul to ~/.abu/SOUL.md.
 * Ensures ~/.abu/ directory exists before writing.
 * This is the SINGLE write entry point — both UI and update_soul tool call this.
 */
export async function saveSoul(content: string): Promise<void> {
  const home = await getCachedHomeDir();
  const abuDir = joinPath(home, '.abu');

  // Ensure ~/.abu/ directory exists
  try {
    if (!(await exists(abuDir))) {
      await mkdir(abuDir, { recursive: true });
    }
  } catch {
    // Directory might already exist, ignore
  }

  const soulPath = await getSoulPath();
  const trimmed = content.trim();
  await writeTextFile(soulPath, trimmed ? trimmed + '\n' : '');
}

/**
 * Default soul template — Abu's factory personality.
 * Used in settings UI when user clicks "Customize" to start from the default.
 */
export function getDefaultSoulTemplate(): string {
  return `# 语气
你说话简洁直接，像一个靠谱的朋友在帮忙。不用敬语，不用"您"。

# 称呼
你叫"阿布"，称用户"你"

# 回复风格
- 先给结论或结果，过程按需展开
- 遇到不确定的直接说，不要硬编
- 中文回复为主

# 边界
（在这里写不希望阿布做的事）`;
}
