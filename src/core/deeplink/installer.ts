/**
 * Deep-link package installer — download a zip from an allowlisted URL and
 * unpack it into the local data directory:
 *
 *   employee → ~/.uprow/employees/<agentName>/   (WorkBuddy/CodeBuddy package,
 *              validated by .codebuddy-plugin/plugin.json)
 *   skill    → ~/.uprow/skills/<name>/           (.askill archive, reuses
 *              core/skill/packager validation + unpack)
 *
 * Re-deploying an already-installed package overwrites it (deploy = sync to
 * the latest hired version). The pure planning step is separated from fs
 * writes so it can be unit-tested without Tauri.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { DATA_DIR_NAME } from '@/core/branding';
import { fetch } from '@tauri-apps/plugin-http';
import { writeFile, mkdir, exists, remove } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import { joinPath } from '@/utils/pathUtils';
import { parsePluginJson } from '@/core/agent/employeeLoader';
import {
  auditEmployeePackage,
  parseEmployeePlugin,
  type EmployeeAuditReport,
  type EmployeeRuntimeProfile,
} from '@/core/employee/contract';
import { validateArchive, unpackSkill } from '@/core/skill/packager';
import type { DeepLinkInstallRequest } from './parser';

// Same budget as the skill packager (.askill).
const MAX_SINGLE_FILE = 10 * 1024 * 1024; // 10 MB per file
const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024; // 50 MB total archive

// VCS/OS noise we never write to disk. Unlike the skill packager we MUST
// keep dot-prefixed entries — the package manifest lives in .codebuddy-plugin/.
const JUNK_SEGMENTS = new Set(['node_modules', '__pycache__', '.git', '.DS_Store', 'Thumbs.db']);

export type DeepLinkInstallErrorCode =
  | 'DOWNLOAD_FAILED'
  | 'ARCHIVE_TOO_LARGE'
  | 'INVALID_ZIP'
  | 'NO_PLUGIN_JSON'
  | 'NO_NAME'
  | 'RESERVED_NAME'
  | 'PATH_TRAVERSAL'
  | 'FILE_TOO_LARGE'
  | 'NO_SKILL_MD'
  | 'WRITE_FAILED';

export class DeepLinkInstallError extends Error {
  code: DeepLinkInstallErrorCode;
  constructor(code: DeepLinkInstallErrorCode, message: string) {
    super(message);
    this.name = 'DeepLinkInstallError';
    this.code = code;
  }
}

export interface InstalledPackage {
  kind: 'employee' | 'skill';
  /** Canonical package name (= directory name under ~/.uprow/...). */
  name: string;
  fileCount: number;
  runtimeProfile?: EmployeeRuntimeProfile;
  audit?: EmployeeAuditReport;
}

// ── Employee package: pure planning ───────────────────────────────────────

export interface EmployeeUnpackPlan {
  /** Canonical agent name (registry key + target directory name). */
  name: string;
  /** Files to write, paths relative to the package root. */
  files: Array<{ path: string; data: Uint8Array }>;
  runtimeProfile?: EmployeeRuntimeProfile;
  audit: EmployeeAuditReport;
}

/** True when a name is safe to use as a single directory component. */
function isSafeDirName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

/**
 * Plan an employee package unpack from raw zip entries. Pure — no fs access.
 * Locates .codebuddy-plugin/plugin.json (root level or nested one directory
 * deep, as produced by zipping the package's parent), extracts the canonical
 * agent name, and returns the file list with the prefix stripped.
 *
 * @throws DeepLinkInstallError on any validation failure
 */
export function planEmployeeUnpack(rawEntries: Record<string, Uint8Array>): EmployeeUnpackPlan {
  // Windows-built archives (PowerShell Compress-Archive and friends) use "\"
  // as the entry separator — normalize to "/" before any matching.
  const entries: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(rawEntries)) {
    entries[path.replace(/\\/g, '/')] = data;
  }

  const manifestKey = Object.keys(entries).find(
    (k) => k === '.codebuddy-plugin/plugin.json' || k.endsWith('/.codebuddy-plugin/plugin.json'),
  );
  if (!manifestKey) {
    throw new DeepLinkInstallError('NO_PLUGIN_JSON', 'Archive does not contain .codebuddy-plugin/plugin.json');
  }

  // Prefix to strip, e.g. "new-media-ops/" when zipped from the parent dir.
  const prefix = manifestKey.slice(0, manifestKey.length - '.codebuddy-plugin/plugin.json'.length);

  const rawPlugin = strFromU8(entries[manifestKey]);
  const plugin = parsePluginJson(rawPlugin);
  const name = plugin?.agentName || plugin?.name;
  if (!name || !isSafeDirName(name)) {
    throw new DeepLinkInstallError('NO_NAME', 'plugin.json is missing a valid agentName/name');
  }
  // 'abu' is the default routing agent — a package must never shadow it
  // (the agent registry skips it too; reject early for a clear error).
  if (name === 'abu') {
    throw new DeepLinkInstallError('RESERVED_NAME', 'Package name "abu" is reserved');
  }

  const files: EmployeeUnpackPlan['files'] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (path.includes('..') || path.startsWith('/')) {
      throw new DeepLinkInstallError('PATH_TRAVERSAL', `Unsafe path in archive: ${path}`);
    }
    if (data.length > MAX_SINGLE_FILE) {
      throw new DeepLinkInstallError('FILE_TOO_LARGE', `File "${path}" exceeds ${MAX_SINGLE_FILE / 1024 / 1024}MB limit`);
    }

    if (prefix && !path.startsWith(prefix)) continue; // outside the package dir
    const rel = prefix ? path.slice(prefix.length) : path;
    if (!rel || rel.endsWith('/')) continue; // directory entries

    if (rel.split('/').some((seg) => JUNK_SEGMENTS.has(seg))) continue;

    files.push({ path: rel, data });
  }

  const manifest = parseEmployeePlugin(rawPlugin);
  const audit = auditEmployeePackage({
    manifest,
    files: files.map((file) => file.path),
  });

  return {
    name,
    files,
    runtimeProfile: manifest?.runtime,
    audit,
  };
}

// ── Download + install ─────────────────────────────────────────────────────

/** Download a package archive. Caller must have validated the URL already. */
async function downloadArchive(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (err) {
    throw new DeepLinkInstallError('DOWNLOAD_FAILED', `Download failed: ${String(err)}`);
  }
  if (!res.ok) {
    throw new DeepLinkInstallError('DOWNLOAD_FAILED', `Download failed: HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_ARCHIVE_SIZE) {
    throw new DeepLinkInstallError('ARCHIVE_TOO_LARGE', `Archive exceeds ${MAX_ARCHIVE_SIZE / 1024 / 1024}MB limit`);
  }
  return bytes;
}

/** Unpack an employee archive into ~/.uprow/employees/<name>/ (overwrites). */
async function installEmployeeArchive(bytes: Uint8Array): Promise<InstalledPackage> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new DeepLinkInstallError('INVALID_ZIP', 'File is not a valid zip archive');
  }

  const plan = planEmployeeUnpack(entries);

  const home = await homeDir();
  const targetDir = joinPath(home, DATA_DIR_NAME, 'employees', plan.name);

  try {
    // Overwrite semantics: clear a previous deployment so stale files
    // (removed skills, renamed agents) don't linger.
    if (await exists(targetDir)) {
      await remove(targetDir, { recursive: true });
    }
    for (const file of plan.files) {
      const targetPath = joinPath(targetDir, file.path);
      const parentDir = targetPath.substring(0, targetPath.lastIndexOf('/'));
      if (parentDir) {
        await mkdir(parentDir, { recursive: true });
      }
      await writeFile(targetPath, file.data);
    }
  } catch (err) {
    if (err instanceof DeepLinkInstallError) throw err;
    throw new DeepLinkInstallError('WRITE_FAILED', `Failed to write package: ${String(err)}`);
  }

  return {
    kind: 'employee',
    name: plan.name,
    fileCount: plan.files.length,
    runtimeProfile: plan.runtimeProfile,
    audit: plan.audit,
  };
}

/** Unpack a .askill archive into ~/.uprow/skills/<name>/ (overwrites). */
async function installSkillArchive(bytes: Uint8Array): Promise<InstalledPackage> {
  const validationError = validateArchive(bytes);
  if (validationError) {
    const code: DeepLinkInstallErrorCode =
      validationError.code === 'INVALID_ZIP' ? 'INVALID_ZIP' : validationError.code;
    throw new DeepLinkInstallError(code, validationError.message);
  }

  const home = await homeDir();
  const baseDir = joinPath(home, DATA_DIR_NAME, 'skills');
  try {
    const result = await unpackSkill(bytes, baseDir, { overwrite: true });
    return { kind: 'skill', name: result.name, fileCount: result.files.length };
  } catch (err) {
    throw new DeepLinkInstallError('WRITE_FAILED', `Failed to write skill: ${String(err)}`);
  }
}

/**
 * Execute a confirmed deep-link install request: download the archive and
 * unpack it into the local data directory.
 */
export async function installFromDeepLink(req: DeepLinkInstallRequest): Promise<InstalledPackage> {
  const bytes = await downloadArchive(req.url);
  return req.pkgType === 'employee'
    ? installEmployeeArchive(bytes)
    : installSkillArchive(bytes);
}
