/**
 * Cross-platform Path Utilities
 * Normalizes path separators so all internal logic can use '/' uniformly.
 * On macOS these are essentially no-ops.
 */

/**
 * Normalize backslashes to forward slashes.
 * macOS paths never contain backslashes, so this is a no-op on macOS.
 */
export function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Get the last segment of a path (file or folder name).
 * Replaces `path.split('/').pop()` patterns.
 */
export function getBaseName(p: string): string {
  const normalized = normalizeSeparators(p);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Get the parent directory of a path.
 * Replaces `path.substring(0, path.lastIndexOf('/'))` patterns.
 */
export function getParentDir(p: string): string {
  const normalized = normalizeSeparators(p);
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.substring(0, idx);
}

/**
 * Join path segments using '/'.
 * Ensures no double slashes at join points.
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((s) => normalizeSeparators(s))
    .join('/')
    .replace(/\/{2,}/g, '/');
}

/**
 * Extract username from a home directory path.
 * - macOS: /Users/alice → alice
 * - Windows: C:/Users/alice → alice
 */
export function extractUsername(homePath: string): string {
  const normalized = normalizeSeparators(homePath);
  const parts = normalized.split('/').filter(Boolean);
  // On Windows the first part may be "C:", skip it
  return parts[parts.length - 1] || 'user';
}

/**
 * Ensure the parent directory of a file path exists, creating it if needed.
 * Uses mkdir(recursive:true) directly — no need to check exists() first.
 */
export async function ensureParentDir(filePath: string): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs');
  const parent = getParentDir(filePath);
  if (parent && parent !== '/') {
    await mkdir(parent, { recursive: true });
  }
}

/** Windows drive-letter path pattern, e.g. C:/ or D:\ */
const WIN_DRIVE_RE = /^[A-Za-z]:[/\\]/;

/**
 * Check if a string looks like a local absolute file path (not a URL).
 * Handles both Unix (/...) and Windows (C:/...) styles.
 */
export function isLocalFilePath(s: string): boolean {
  return s.startsWith('/') || WIN_DRIVE_RE.test(s);
}

/**
 * Resolve a package/runtime-declared relative path inside a selected workspace.
 * Absolute local paths are returned unchanged. Relative paths that attempt to
 * escape the workspace are rejected.
 */
export function resolveWorkspaceRelativePath(path: string, workspacePath?: string | null): string {
  const normalized = normalizeSeparators(path.trim());
  if (!normalized || isLocalFilePath(normalized)) return normalized;
  if (!workspacePath) {
    throw new Error(`Relative path "${path}" requires a selected workspace.`);
  }
  if (normalized === '~' || normalized.startsWith('~/')) {
    throw new Error(`Path "${path}" must be absolute or relative to the selected workspace.`);
  }

  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new Error(`Path "${path}" escapes the selected workspace.`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return joinPath(workspacePath, ...segments);
}

/** MIME types for common image extensions */
export const IMAGE_MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon',
};

/**
 * Load a local image file as a blob URL via Tauri readFile.
 * Caller is responsible for calling URL.revokeObjectURL() on the returned URL when done.
 */
export async function loadLocalImage(filePath: string): Promise<string> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const data = await readFile(filePath);
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const blob = new Blob([data], { type: IMAGE_MIME_MAP[ext] || 'image/png' });
  return URL.createObjectURL(blob);
}
