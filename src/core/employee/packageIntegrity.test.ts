import { beforeAll, describe, expect, it, vi } from 'vitest';
import { strToU8 } from 'fflate';
import { exists, readDir, readFile } from '@tauri-apps/plugin-fs';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import {
  assertEmployeePackageIntegrity,
  INTEGRITY_MANIFEST_PATH,
  INTEGRITY_SIGNATURE_PATH,
  verifyEmployeePackageEntries,
} from './packageIntegrity';

let privateKey: CryptoKey;
let publicKeyBase64: string;

function base64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const PLATFORM_MANIFEST = 'eyJzY2hlbWFWZXJzaW9uIjoxLCJhbGdvcml0aG0iOiJSU0EtUFNTLVNIQTI1NiIsImtleUlkIjoidXByb3ctcHJvZC0yMDI2LTA3IiwicGFja2FnZUlkIjoic2lnbmVkLWZpeHR1cmUiLCJwYWNrYWdlVmVyc2lvbiI6IjEuMC4wIiwiZmlsZXMiOlt7InBhdGgiOiIuY29kZWJ1ZGR5LXBsdWdpbi9wbHVnaW4uanNvbiIsInNpemUiOjExMiwic2hhMjU2IjoiMmNiYmUxYzZlMWExMzNhNzNlZWU4ZGRlZWM1YzcwNzBjN2FkMDY0MmI0MTYxNGE3NmU3ZWY4Y2MzMGU4YWIzOSJ9LHsicGF0aCI6ImFnZW50cy9zaWduZWQtZml4dHVyZS5tZCIsInNpemUiOjIyLCJzaGEyNTYiOiI5MzRmZGY4MmIxMzFlMTU0ZWZhNDJkNDAzZWFmNmNjYTVkZmM5NWY4ODZhZWNlYThhZWM2MzNiNmM0Zjc0M2NiIn1dfQ==';
const PLATFORM_SIGNATURE = 'hQTY9k81tP76SN+bXInrXj/kEd/jNN2SHCwETppNc+gxG6CRUpYpCjKuF/zDRpdahc8MKxaWxNAyBr4vjR/KuPGEuVm+xotSSh+VlxkbBZwSTWm4RjjeIVpHEk450mT14eyBm66LscQT9Q9t1OlFPWDffHKlmyY7WbcXQZwecV8PIiTlU4+n9tYPcCmoq0HW6OoDy2ithrsz2+04xL7d6t4PVlZBF5fYsHKuJwToxB86dW+tBY/m5fc6niewfUPSQ9WWQgZcvPJbHBAbdyNwEeaGSXdrwzf2NzEfVj9pK3TyJV817xseSZfWBivofuao0JA+y9BLNLjdDabKv1Vh9I/chVk8vP13I+Fl0BuwEeK6RupuIczAwyesnGOHAp8v79wpXbGvIGjiAs0+cakBgYOqnPk8q0arnQ5Rfwd7RwnlQfX/Km/Uit1wemVLW67S3PcsBA6jSezDgkGeazaI/eglKGETLNIZMC0Vu2N1HBicwp617Lhn3RJN4RQc348W';

function platformFixtureEntries(): Record<string, Uint8Array> {
  return {
    '.codebuddy-plugin/plugin.json': strToU8('{"name":"signed-fixture","agentName":"signed-fixture","version":"1.0.0","agents":["./agents/signed-fixture.md"]}'),
    'agents/signed-fixture.md': strToU8('Signed fixture prompt.'),
    [INTEGRITY_MANIFEST_PATH]: fromBase64(PLATFORM_MANIFEST),
    [INTEGRITY_SIGNATURE_PATH]: fromBase64(PLATFORM_SIGNATURE),
  };
}

async function signedEntries(files: Record<string, string>) {
  const fileEntries = Object.entries(files).map(([path, content]) => ({ path, data: strToU8(content) }));
  const manifest = {
    schemaVersion: 1,
    algorithm: 'RSA-PSS-SHA256',
    keyId: 'test-key',
    packageId: 'employee-a',
    packageVersion: '1.0.0',
    files: await Promise.all(fileEntries.map(async ({ path, data }) => ({
      path,
      size: data.length,
      sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)))
        .map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    }))),
  };
  const manifestBytes = strToU8(JSON.stringify(manifest));
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    privateKey,
    manifestBytes as BufferSource,
  ));
  return {
    ...Object.fromEntries(fileEntries.map(({ path, data }) => [path, data])),
    [INTEGRITY_MANIFEST_PATH]: manifestBytes,
    [INTEGRITY_SIGNATURE_PATH]: signature,
  };
}

beforeAll(async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  privateKey = keys.privateKey;
  publicKeyBase64 = base64(await crypto.subtle.exportKey('spki', keys.publicKey));
});

describe('employee package integrity verification', () => {
  it('verifies the fixed vector produced by the platform signer', async () => {
    await expect(verifyEmployeePackageEntries(platformFixtureEntries(), { required: true })).resolves.toEqual({
      keyId: 'uprow-prod-2026-07',
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('accepts an authentic package and returns a stable expectation', async () => {
    const entries = await signedEntries({
      '.codebuddy-plugin/plugin.json': '{"name":"employee-a","version":"1.0.0"}',
      'agents/employee-a.md': 'prompt',
    });
    await expect(verifyEmployeePackageEntries(entries, {
      required: true,
      trustedKeys: { 'test-key': publicKeyBase64 },
    })).resolves.toEqual({
      keyId: 'test-key',
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejects modified or added files', async () => {
    const entries = await signedEntries({
      '.codebuddy-plugin/plugin.json': '{"name":"employee-a","version":"1.0.0"}',
      'agents/employee-a.md': 'prompt',
    });
    entries['agents/employee-a.md'] = strToU8('tampered');
    await expect(verifyEmployeePackageEntries(entries, {
      trustedKeys: { 'test-key': publicKeyBase64 },
    })).rejects.toThrow(/校验失败/);

    const authentic = await signedEntries({
      '.codebuddy-plugin/plugin.json': '{"name":"employee-a","version":"1.0.0"}',
    });
    authentic['extra.txt'] = strToU8('extra');
    await expect(verifyEmployeePackageEntries(authentic, {
      trustedKeys: { 'test-key': publicKeyBase64 },
    })).rejects.toThrow(/文件集合/);
  });

  it('fails closed when a required signature is missing or unknown', async () => {
    await expect(verifyEmployeePackageEntries({
      '.codebuddy-plugin/plugin.json': strToU8('{}'),
    }, { required: true })).rejects.toThrow(/缺少签名/);

    const entries = await signedEntries({
      '.codebuddy-plugin/plugin.json': '{"name":"employee-a","version":"1.0.0"}',
    });
    await expect(verifyEmployeePackageEntries(entries, {
      trustedKeys: {},
    })).rejects.toThrow(/未知签名密钥/);
  });

  it('requires a signed package to match the current platform deployment conversation', async () => {
    const root = 'C:/Users/test/.uprow/employees/signed-fixture';
    const entries = platformFixtureEntries();
    const children: Record<string, Array<[string, boolean]>> = {
      '': [['.codebuddy-plugin', true], ['agents', true], ['.uprow', true]],
      '.codebuddy-plugin': [['plugin.json', false]],
      agents: [['signed-fixture.md', false]],
      '.uprow': [['integrity.json', false], ['integrity.sig', false]],
    };
    const relativePath = (path: string) => path === root ? '' : path.slice(root.length + 1);

    useEmployeeDeploymentStore.setState({ integrity: {}, deployments: {} });
    vi.mocked(exists).mockImplementation(async (path) => (
      relativePath(String(path)) === INTEGRITY_MANIFEST_PATH
      || relativePath(String(path)) === INTEGRITY_SIGNATURE_PATH
    ));
    vi.mocked(readDir).mockImplementation(async (path) => (
      (children[relativePath(String(path))] ?? []).map(([name, isDirectory]) => ({
        name,
        isDirectory,
        isFile: !isDirectory,
        isSymlink: false,
      })) as never
    ));
    vi.mocked(readFile).mockImplementation(async (path) => {
      const data = entries[relativePath(String(path))];
      if (!data) throw new Error(`Missing fixture: ${String(path)}`);
      return data;
    });

    const agent = {
      name: 'signed-fixture',
      description: 'fixture',
      systemPrompt: 'fixture',
      source: 'employee' as const,
      filePath: `${root}/.codebuddy-plugin/plugin.json`,
    };
    const integrity = await verifyEmployeePackageEntries(entries, { required: true });
    await expect(assertEmployeePackageIntegrity(agent, 'conv-platform')).rejects.toThrow(/未绑定当前企业部署/);

    useEmployeeDeploymentStore.setState({
      deployments: {
        dep_platform: {
          packageId: 'signed-fixture',
          employeeId: 'emp-platform',
          hireId: 'hire-platform',
          deploymentId: 'dep_11111111111111111111111111111111',
          integrityKeyId: integrity!.keyId,
          integrityManifestSha256: integrity!.manifestSha256,
          agentName: 'signed-fixture',
          workspacePath: null,
          conversationId: 'conv-platform',
          configuredAt: 1,
        },
      },
    });
    await expect(assertEmployeePackageIntegrity(agent, 'conv-platform')).resolves.toBeUndefined();
    await expect(assertEmployeePackageIntegrity(agent, 'conv-other')).rejects.toThrow(/未绑定当前企业部署/);

    entries['agents/signed-fixture.md'] = strToU8('tampered');
    await expect(assertEmployeePackageIntegrity(agent, 'conv-platform')).rejects.toThrow(/校验失败/);
  });
});
