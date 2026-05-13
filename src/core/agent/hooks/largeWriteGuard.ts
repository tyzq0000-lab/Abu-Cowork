/**
 * Large-write guard hook.
 *
 * Blocks `write_file` calls that target an already-existing file whose
 * current size exceeds LARGE_WRITE_THRESHOLD_BYTES. Forces the agent
 * onto edit_file for partial modifications instead of full overwrite.
 *
 * Background: when a multi-section document (HTML report, markdown
 * report, long code file) is fully overwritten, sections the user did
 * not ask to change can drift or get silently regenerated with wrong
 * data. edit_file's unique-match contract makes that impossible.
 *
 * Threshold is currently chosen from a single observed case (35 KB
 * HTML report overwrite). Revisit once real-world distribution data
 * is available.
 */
import { exists, stat } from '@tauri-apps/plugin-fs';
import { registerHook } from '../lifecycleHooks';
import type { PreToolCallEvent } from '../lifecycleHooks';
import { TOOL_NAMES } from '../../tools/toolNames';

export const LARGE_WRITE_THRESHOLD_BYTES = 8 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function buildBlockReason(path: string, size: number): string {
  return `Error: write_file rejected — ${path} already exists (${formatSize(size)}). ` +
    `Full-file overwrite would silently drop sections the user did not ask to change. ` +
    `Use edit_file with old_content + new_content to replace only what needs to change. ` +
    `If a complete rewrite is genuinely intended, delete the file via run_command first, then write_file.`;
}

/**
 * Inspect a single preToolCall event and, when it targets write_file
 * over an existing large file, attach blockReason so the executor
 * surfaces an error result to the agent.
 *
 * Exposed for unit testing; production code registers it via
 * installLargeWriteGuard().
 */
export async function evaluateLargeWriteGuard(event: PreToolCallEvent): Promise<void> {
  if (event.toolName !== TOOL_NAMES.WRITE_FILE) return;
  const path = event.toolInput?.path;
  if (typeof path !== 'string' || !path) return;

  try {
    const fileExists = await exists(path);
    if (!fileExists) return;

    const info = await stat(path);
    const size = typeof info?.size === 'number' ? info.size : 0;
    if (size < LARGE_WRITE_THRESHOLD_BYTES) return;

    event.blocked = true;
    event.blockReason = buildBlockReason(path, size);
  } catch {
    // Fail open: if exists/stat throws (permissions, sandbox, etc.),
    // let the real write_file path surface the underlying error.
  }
}

/**
 * Register the guard on the global preToolCall hook bus.
 * Idempotent: repeated calls (e.g. React StrictMode double-mount) reuse
 * the existing registration. Returns the cleanup fn from the first call.
 */
let cleanupFn: (() => void) | null = null;
export function installLargeWriteGuard(): () => void {
  if (cleanupFn) return cleanupFn;
  const cleanup = registerHook<PreToolCallEvent>('preToolCall', evaluateLargeWriteGuard, 50);
  cleanupFn = () => {
    cleanup();
    cleanupFn = null;
  };
  return cleanupFn;
}
