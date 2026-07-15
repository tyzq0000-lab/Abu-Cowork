import { exists, readDir, readFile } from '@tauri-apps/plugin-fs';
import type { SubagentDefinition } from '@/types';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import { getBaseName, getParentDir, joinPath } from '@/utils/pathUtils';

export const INTEGRITY_MANIFEST_PATH = '.uprow/integrity.json';
export const INTEGRITY_SIGNATURE_PATH = '.uprow/integrity.sig';
const INTEGRITY_ALGORITHM = 'RSA-PSS-SHA256' as const;

const TRUSTED_PACKAGE_KEYS: Readonly<Record<string, string>> = {
  'uprow-prod-2026-07': 'MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAjgEahYZTBBuQatU5oXwU+eob0JOQ37bCVI7g7TAozwZZ5rBoKtqDPGrc0f2O/F9XVJsNKD3fLKV3zypOD2lPxkhRkfpP2zJE5I7qxWmVSaUx1BFwIQTx2G9jn3ir86S81ex+g/TYzD0F+2IA+yZc5as+JmBEXZlAajQszguHnTp9p7NBtXu7ydB7MBviIr0TDTZZwTkslqv6R8U+1fsLVatjdmkAS+JihPDDxDoGrzhI6tbJ0yonj6dAm7/ROAxoTcOTTbpOyJodSZOls27/3i8ASzTqW0et/vmcrux1hfpO4DrJrqtjc4VRPyrBuBzvDKMQxhKacOassXkaux9BgrwkUERnjk2+KmOkJpsvKuQvWPYGPzOj75r+eeT+CLhuOkn3Fc/r9+QSYLU9rSvs8DQ+SDcZf/rBVQ3BsWvgOLm4kS5MUuztxJZOZ0WUm3Op2T8YrWaKloQVaRpdl0CO4QLbe1SXHhjMZd5f21mdTTgENHOD97Z9X1xFfvlMgflZAgMBAAE=',
};

export interface PackageIntegrityExpectation {
  keyId: string;
  manifestSha256: string;
}

interface PackageIntegrityManifest {
  schemaVersion: 1;
  algorithm: typeof INTEGRITY_ALGORITHM;
  keyId: string;
  packageId: string;
  packageVersion: string;
  files: Array<{ path: string; size: number; sha256: string }>;
}

export class PackageIntegrityError extends Error {
  readonly code: 'SIGNATURE_REQUIRED' | 'INVALID_INTEGRITY';

  constructor(
    code: 'SIGNATURE_REQUIRED' | 'INVALID_INTEGRITY',
    message: string,
  ) {
    super(message);
    this.name = 'PackageIntegrityError';
    this.code = code;
  }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(data: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '');
}

function safePath(raw: string): string | null {
  const path = normalizePath(raw);
  const segments = path.split('/');
  if (
    !path
    || path.startsWith('/')
    || path.includes('\0')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) return null;
  return path;
}

function parseManifest(bytes: Uint8Array): PackageIntegrityManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包完整性清单不是合法 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包完整性清单结构无效');
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.schemaVersion !== 1
    || value.algorithm !== INTEGRITY_ALGORITHM
    || typeof value.keyId !== 'string'
    || !value.keyId
    || typeof value.packageId !== 'string'
    || !value.packageId
    || typeof value.packageVersion !== 'string'
    || !value.packageVersion
    || !Array.isArray(value.files)
  ) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包完整性清单字段无效');
  }
  const files: PackageIntegrityManifest['files'] = [];
  const seen = new Set<string>();
  for (const item of value.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包完整性文件条目无效');
    }
    const file = item as Record<string, unknown>;
    const path = typeof file.path === 'string' ? safePath(file.path) : null;
    const collisionKey = path?.toLocaleLowerCase('en-US');
    if (
      !path
      || !collisionKey
      || seen.has(collisionKey)
      || collisionKey === INTEGRITY_MANIFEST_PATH.toLowerCase()
      || collisionKey === INTEGRITY_SIGNATURE_PATH.toLowerCase()
      || !Number.isSafeInteger(file.size)
      || (file.size as number) < 0
      || typeof file.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包完整性文件条目无效');
    }
    seen.add(collisionKey);
    files.push({ path, size: file.size as number, sha256: file.sha256 });
  }
  return {
    schemaVersion: 1,
    algorithm: INTEGRITY_ALGORITHM,
    keyId: value.keyId,
    packageId: value.packageId,
    packageVersion: value.packageVersion,
    files,
  };
}

export async function verifyEmployeePackageEntries(
  rawEntries: Record<string, Uint8Array>,
  options: {
    required?: boolean;
    trustedKeys?: Readonly<Record<string, string>>;
  } = {},
): Promise<PackageIntegrityExpectation | null> {
  const entries = new Map<string, Uint8Array>();
  const pathKeys = new Set<string>();
  for (const [rawPath, data] of Object.entries(rawEntries)) {
    if (rawPath.endsWith('/') || rawPath.endsWith('\\')) continue;
    const path = safePath(rawPath);
    const collisionKey = path?.toLocaleLowerCase('en-US');
    if (!path || !collisionKey || pathKeys.has(collisionKey)) {
      throw new PackageIntegrityError('INVALID_INTEGRITY', `员工包包含不安全或冲突路径：${rawPath}`);
    }
    pathKeys.add(collisionKey);
    entries.set(path, data);
  }

  const manifestBytes = entries.get(INTEGRITY_MANIFEST_PATH);
  const signature = entries.get(INTEGRITY_SIGNATURE_PATH);
  if (!manifestBytes && !signature) {
    if (options.required) {
      throw new PackageIntegrityError('SIGNATURE_REQUIRED', '该平台员工包缺少签名，已拒绝安装或运行');
    }
    return null;
  }
  if (!manifestBytes || !signature) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包签名文件不完整');
  }

  const manifest = parseManifest(manifestBytes);
  const publicKeyBase64 = (options.trustedKeys ?? TRUSTED_PACKAGE_KEYS)[manifest.keyId];
  if (!publicKeyBase64) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', `员工包使用了未知签名密钥：${manifest.keyId}`);
  }
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'spki',
      bytesFromBase64(publicKeyBase64) as BufferSource,
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '扶摇内置的员工包验签公钥无效');
  }
  const validSignature = await crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength: 32 },
    publicKey,
    signature as BufferSource,
    manifestBytes as BufferSource,
  );
  if (!validSignature) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包签名无效，文件可能已被篡改');
  }

  const packageFiles = [...entries.entries()].filter(([path]) => (
    path !== INTEGRITY_MANIFEST_PATH && path !== INTEGRITY_SIGNATURE_PATH
  ));
  if (packageFiles.length !== manifest.files.length) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包文件集合与签名清单不一致');
  }
  for (const expected of manifest.files) {
    const data = entries.get(expected.path);
    if (!data || data.length !== expected.size || await sha256(data) !== expected.sha256) {
      throw new PackageIntegrityError('INVALID_INTEGRITY', `员工包文件校验失败：${expected.path}`);
    }
  }

  const pluginBytes = entries.get('.codebuddy-plugin/plugin.json');
  if (!pluginBytes) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '签名员工包缺少 plugin.json');
  }
  try {
    const plugin = JSON.parse(new TextDecoder().decode(pluginBytes)) as { name?: unknown; version?: unknown };
    if (plugin.name !== manifest.packageId || plugin.version !== manifest.packageVersion) {
      throw new Error('identity mismatch');
    }
  } catch {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包身份或版本与签名清单不一致');
  }

  return { keyId: manifest.keyId, manifestSha256: await sha256(manifestBytes) };
}

async function readPackageDirectory(
  root: string,
  current = root,
  relative = '',
  out: Record<string, Uint8Array> = {},
): Promise<Record<string, Uint8Array>> {
  for (const entry of await readDir(current)) {
    if (entry.isSymlink) {
      throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包目录包含符号链接，已拒绝运行');
    }
    const path = joinPath(current, entry.name);
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      await readPackageDirectory(root, path, rel, out);
    } else {
      out[rel] = new Uint8Array(await readFile(path));
    }
  }
  return out;
}

export async function assertEmployeePackageIntegrity(
  agent: SubagentDefinition,
  conversationId?: string,
): Promise<void> {
  if (agent.source !== 'employee' || !agent.filePath) return;
  const pluginDir = getParentDir(agent.filePath);
  const packageDir = getBaseName(pluginDir) === '.codebuddy-plugin'
    ? getParentDir(pluginDir)
    : pluginDir;
  const deploymentState = useEmployeeDeploymentStore.getState();
  const expectation = deploymentState.integrity[getBaseName(packageDir)];
  if (!expectation) {
    const [hasManifest, hasSignature] = await Promise.all([
      exists(joinPath(packageDir, INTEGRITY_MANIFEST_PATH)),
      exists(joinPath(packageDir, INTEGRITY_SIGNATURE_PATH)),
    ]);
    if (!hasManifest && !hasSignature) return;
  }
  const actual = await verifyEmployeePackageEntries(
    await readPackageDirectory(packageDir),
    { required: true },
  );
  if (!actual) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '平台签名员工包缺少完整性结果');
  }
  const boundDeployment = Object.values(deploymentState.deployments).find((deployment) => (
    deployment.agentName === agent.name
    && deployment.conversationId === conversationId
    && !!deployment.deploymentId
    && !!deployment.employeeId
    && !!deployment.hireId
    && deployment.integrityKeyId === actual.keyId
    && deployment.integrityManifestSha256 === actual.manifestSha256
  ));
  if (!boundDeployment) {
    throw new PackageIntegrityError(
      'INVALID_INTEGRITY',
      '平台签名员工包未绑定当前企业部署，已拒绝运行。请从有谱平台重新部署该员工。',
    );
  }
  if (!expectation) return;
  if (
    !actual
    || actual.keyId !== expectation.keyId
    || actual.manifestSha256 !== expectation.manifestSha256
  ) {
    throw new PackageIntegrityError('INVALID_INTEGRITY', '员工包与安装时的平台签名不一致，已拒绝运行');
  }
}
