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

import { strToU8, strFromU8, unzipSync } from 'fflate';
import { DATA_DIR_NAME } from '@/core/branding';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { writeFile, mkdir, exists, remove, rename } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import { joinPath } from '@/utils/pathUtils';
import { parsePluginJson } from '@/core/agent/employeeLoader';
import {
  auditEmployeePackage,
  isValidEmployeeModelConfig,
  parseEmployeePlugin,
  type EmployeeAuditReport,
  type EmployeeModelConfig,
  type EmployeeRuntimeProfile,
} from '@/core/employee/contract';
import { useSettingsStore } from '@/stores/settingsStore';
import { validateArchive, unpackSkill } from '@/core/skill/packager';
import {
  PackageIntegrityError,
  verifyEmployeePackageEntries,
  type PackageIntegrityExpectation,
} from '@/core/employee/packageIntegrity';
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
  | 'PACKAGE_SIGNATURE_REQUIRED'
  | 'PACKAGE_INTEGRITY_INVALID'
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
  packageId?: string;
  packageVersion?: string;
  defaultInitPrompt?: { zh?: string; en?: string };
  fileCount: number;
  runtimeProfile?: EmployeeRuntimeProfile;
  audit?: EmployeeAuditReport;
  integrity?: PackageIntegrityExpectation;
}

// ── Employee package: pure planning ───────────────────────────────────────

export interface EmployeeUnpackPlan {
  /** Canonical agent name (registry key + target directory name). */
  name: string;
  packageId: string;
  packageVersion?: string;
  defaultInitPrompt?: { zh?: string; en?: string };
  /** Files to write, paths relative to the package root. */
  files: Array<{ path: string; data: Uint8Array }>;
  modelConfig?: EmployeeModelConfig;
  runtimeProfile?: EmployeeRuntimeProfile;
  audit: EmployeeAuditReport;
  integrity?: PackageIntegrityExpectation;
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
export function planEmployeeUnpack(
  rawEntries: Record<string, Uint8Array>,
  options?: { integrity?: PackageIntegrityExpectation },
): EmployeeUnpackPlan {
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
    // 按路径段精确判 '..'（与签名路径 packageIntegrity.ts 的 safePath 一致）；
    // 子串 includes('..') 会误伤 chapter1..2.md 这类合法文件名，挡掉正常包安装。
    if (path.startsWith('/') || path.split('/').some((seg) => seg === '..')) {
      throw new DeepLinkInstallError('PATH_TRAVERSAL', `Unsafe path in archive: ${path}`);
    }
    if (data.length > MAX_SINGLE_FILE) {
      throw new DeepLinkInstallError('FILE_TOO_LARGE', `File "${path}" exceeds ${MAX_SINGLE_FILE / 1024 / 1024}MB limit`);
    }

    if (prefix && !path.startsWith(prefix)) continue; // outside the package dir
    const rel = prefix ? path.slice(prefix.length) : path;
    if (!rel || rel.endsWith('/')) continue; // directory entries

    if (!options?.integrity && rel.split('/').some((seg) => JUNK_SEGMENTS.has(seg))) continue;

    files.push({ path: rel, data });
  }

  const manifest = parseEmployeePlugin(rawPlugin);
  const audit = auditEmployeePackage({
    manifest,
    files: files.map((file) => file.path),
  });

  // A maker-supplied modelConfig may be malformed (e.g. `{}` with no provider).
  // Validate before any `.provider.*` access — skip injection and record a
  // non-blocking gap instead of crashing the whole install.
  const rawModelConfig = manifest?.modelConfig;
  let modelConfig: EmployeeModelConfig | undefined;
  if (rawModelConfig !== undefined) {
    if (isValidEmployeeModelConfig(rawModelConfig)) {
      modelConfig = rawModelConfig;
    } else {
      audit.gaps.push({
        owner: 'employee-package',
        code: 'INVALID_MODEL_CONFIG',
        message: 'modelConfig is malformed (missing or invalid provider) — model injection skipped.',
        blocking: false,
      });
    }
  }

  // Never persist maker API keys to disk: rewrite the on-disk plugin.json
  // with blanked keys. The live key is handed to the encrypted secret store
  // by the install step (upsertEmployeeProvider).
  if (options?.integrity && modelConfig && (modelConfig.provider.apiKey || modelConfig.imageGen?.apiKey)) {
    throw new DeepLinkInstallError(
      'PACKAGE_INTEGRITY_INVALID',
      'Signed employee packages must not contain model API keys.',
    );
  }
  if (!options?.integrity && modelConfig && (modelConfig.provider.apiKey || modelConfig.imageGen?.apiKey)) {
    const sanitized = {
      ...manifest,
      modelConfig: {
        ...modelConfig,
        provider: { ...modelConfig.provider, apiKey: '' },
        ...(modelConfig.imageGen ? { imageGen: { ...modelConfig.imageGen, apiKey: '' } } : {}),
      },
    };
    const manifestRel = '.codebuddy-plugin/plugin.json';
    const idx = files.findIndex((f) => f.path === manifestRel);
    if (idx >= 0) {
      files[idx] = { path: manifestRel, data: strToU8(JSON.stringify(sanitized, null, 2)) };
    }
  }

  return {
    name,
    packageId: manifest?.name || name,
    packageVersion: manifest?.version,
    defaultInitPrompt: manifest?.defaultInitPrompt,
    files,
    modelConfig,
    runtimeProfile: manifest?.runtime,
    audit,
    integrity: options?.integrity,
  };
}

// ── Download + install ─────────────────────────────────────────────────────

/** Download a package archive. Caller must have validated the URL already. */
async function downloadArchive(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    const host = new URL(url).hostname;
    const isLoopback = host === 'localhost' || host === '127.0.0.1';
    // Local platform development should not be routed through a system proxy.
    // The WebView transport is sufficient because the platform ZIP endpoint
    // explicitly allows CORS; production HTTPS downloads keep using Tauri.
    res = isLoopback
      ? await globalThis.fetch(url, { method: 'GET' })
      : await tauriFetch(url, { method: 'GET' });
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
async function installEmployeeArchive(
  bytes: Uint8Array,
  integrityRequired: boolean,
): Promise<InstalledPackage> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new DeepLinkInstallError('INVALID_ZIP', 'File is not a valid zip archive');
  }

  let integrity: PackageIntegrityExpectation | null;
  try {
    integrity = await verifyEmployeePackageEntries(entries, { required: integrityRequired });
  } catch (error) {
    if (error instanceof PackageIntegrityError) {
      const code: DeepLinkInstallErrorCode = error.code === 'SIGNATURE_REQUIRED'
        ? 'PACKAGE_SIGNATURE_REQUIRED'
        : 'PACKAGE_INTEGRITY_INVALID';
      throw new DeepLinkInstallError(code, error.message);
    }
    throw error;
  }

  const plan = planEmployeeUnpack(entries, { integrity: integrity ?? undefined });

  const home = await homeDir();
  const employeesDir = joinPath(home, DATA_DIR_NAME, 'employees');
  const targetDir = joinPath(employeesDir, plan.name);
  const operationId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const stagingDir = joinPath(employeesDir, `.${plan.name}.installing-${operationId}`);
  const backupDir = joinPath(employeesDir, `.${plan.name}.backup-${operationId}`);
  let movedExisting = false;

  try {
    await mkdir(employeesDir, { recursive: true });
    for (const file of plan.files) {
      const targetPath = joinPath(stagingDir, file.path);
      const parentDir = targetPath.substring(0, targetPath.lastIndexOf('/'));
      if (parentDir) {
        await mkdir(parentDir, { recursive: true });
      }
      await writeFile(targetPath, file.data);
    }
    if (await exists(targetDir)) {
      await rename(targetDir, backupDir);
      movedExisting = true;
    }
    await rename(stagingDir, targetDir);
    if (movedExisting && await exists(backupDir)) {
      await remove(backupDir, { recursive: true });
    }
  } catch (err) {
    try {
      if (await exists(stagingDir)) await remove(stagingDir, { recursive: true });
      if (movedExisting && !(await exists(targetDir)) && await exists(backupDir)) {
        await rename(backupDir, targetDir);
      }
    } catch {
      // Preserve the original install error; recovery is best effort.
    }
    if (err instanceof DeepLinkInstallError) throw err;
    throw new DeepLinkInstallError('WRITE_FAILED', `Failed to write package: ${String(err)}`);
  }

  // Maker-pinned model: register the dedicated provider (key -> encrypted
  // secret store). Conversations with this employee route through it via
  // resolveAgentExecution; everything else keeps the global provider.
  if (plan.modelConfig) {
    useSettingsStore.getState().upsertEmployeeProvider(plan.name, plan.modelConfig);
  }

  return {
    kind: 'employee',
    name: plan.name,
    packageId: plan.packageId,
    packageVersion: plan.packageVersion,
    defaultInitPrompt: plan.defaultInitPrompt,
    fileCount: plan.files.length,
    runtimeProfile: plan.runtimeProfile,
    audit: plan.audit,
    integrity: plan.integrity,
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
    ? installEmployeeArchive(bytes, req.integrityRequired === true)
    : installSkillArchive(bytes);
}
