/**
 * Memdir Paths — memory directory resolution.
 *
 * Resolution (aligned with Claude Code):
 *   With workspace:  ~/.uprow/projects/<sanitized-workspace-path>/memory/
 *   Without:         ~/.uprow/memory/                    (global fallback)
 *
 * sanitizePath replaces non-alphanumeric chars with hyphens, truncates + hashes
 * if the result exceeds filesystem limits (255 bytes).
 */

import { homeDir } from '@tauri-apps/api/path';
import { DATA_DIR_NAME } from '@/core/branding';
import { joinPath, normalizeSeparators } from '../../utils/pathUtils';
import { MEMORY_INDEX_FILENAME } from './types';

const MAX_SANITIZED_LENGTH = 200;

// ── Cached home dir (avoid repeated IPC) ──

let cachedHome: string | null = null;

async function getCachedHome(): Promise<string> {
  if (!cachedHome) cachedHome = await homeDir();
  return cachedHome;
}

// ── Path sanitization (ported from CC's sanitizePath) ──

/**
 * DJB2 hash — deterministic, fast, no crypto dependency.
 * Used as a collision-resistant suffix when the sanitized path is too long.
 */
function djb2Hash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Make a path safe for use as a directory name.
 * Replaces all non-alphanumeric characters with hyphens.
 * Truncates + appends hash if exceeding MAX_SANITIZED_LENGTH.
 *
 * Example: "/Users/didi/Documents/my-project" → "-Users-didi-Documents-my-project"
 */
export function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized;
  }
  const hash = Math.abs(djb2Hash(name)).toString(36);
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hash}`;
}

// ── Memory directory paths ──

/**
 * Get the memory directory for a given workspace.
 * If workspacePath is null/undefined, returns the global memory directory.
 */
export async function getMemoryDir(workspacePath?: string | null): Promise<string> {
  const home = await getCachedHome();
  if (workspacePath) {
    const normalized = normalizeSeparators(workspacePath);
    const key = sanitizePath(normalized);
    return joinPath(home, DATA_DIR_NAME, 'projects', key, 'memory');
  }
  return joinPath(home, DATA_DIR_NAME, 'memory');
}

/**
 * Get the MEMORY.md entrypoint path for a given workspace.
 */
export async function getMemoryEntrypoint(workspacePath?: string | null): Promise<string> {
  const dir = await getMemoryDir(workspacePath);
  return joinPath(dir, MEMORY_INDEX_FILENAME);
}

/**
 * Check if an absolute path is inside any Abu memory directory.
 * Used by pathSafety.ts to whitelist memory directories for file tools.
 */
export async function isMemoryPath(absolutePath: string): Promise<boolean> {
  const home = await getCachedHome();
  const normalized = normalizeSeparators(absolutePath);

  // Global memory dir: ~/.uprow/memory/
  const globalDir = joinPath(home, DATA_DIR_NAME, 'memory');
  if (normalized.startsWith(globalDir + '/') || normalized === globalDir) {
    return true;
  }

  // Per-project memory dir: ~/.uprow/projects/*/memory/
  const projectsPrefix = joinPath(home, DATA_DIR_NAME, 'projects');
  if (normalized.startsWith(projectsPrefix + '/')) {
    const rest = normalized.slice(projectsPrefix.length + 1);
    // rest looks like "<sanitized-key>/memory/..." or "<sanitized-key>/memory"
    const parts = rest.split('/');
    if (parts.length >= 2 && parts[1] === 'memory') {
      return true;
    }
  }

  return false;
}

/** Reset cached home (for testing) */
export function _resetCachedHome(): void {
  cachedHome = null;
}
