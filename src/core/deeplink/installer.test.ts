import { describe, it, expect, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { fetch } from '@tauri-apps/plugin-http';
import { rename, writeFile } from '@tauri-apps/plugin-fs';
import {
  planEmployeeUnpack,
  installFromDeepLink,
  DeepLinkInstallError,
} from './installer';

/** Build zip-entry maps like unzipSync would return. */
function entriesOf(files: Record<string, string>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path] = strToU8(content);
  }
  return out;
}

const PLUGIN_JSON = JSON.stringify({
  name: 'new-media-ops',
  agentName: 'new-media-ops',
  displayName: { zh: '运小运', en: 'Nova' },
  agents: ['./agents/new-media-ops.md'],
});

describe('deeplink installer', () => {
  it('installs a minimum unrelated employee package through the generic path', async () => {
    const archive = zipSync(entriesOf({
      '.codebuddy-plugin/plugin.json': JSON.stringify({
        name: 'inventory-clerk',
        agentName: 'inventory-clerk',
        version: '0.1.0',
        agents: ['./agents/inventory-clerk.md'],
      }),
      'agents/inventory-clerk.md': 'Maintain an inventory ledger.',
    }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(archive, { status: 200 }));

    const installed = await installFromDeepLink({
      action: 'install',
      pkgType: 'employee',
      url: 'https://abu-agent.oss-cn-beijing.aliyuncs.com/employees/inventory-clerk.zip',
      packageId: 'inventory-clerk',
      packageVersion: '0.1.0',
    });

    expect(installed).toEqual(expect.objectContaining({
      kind: 'employee',
      name: 'inventory-clerk',
      packageId: 'inventory-clerk',
      packageVersion: '0.1.0',
    }));
    expect(vi.mocked(writeFile)).toHaveBeenCalled();
    expect(vi.mocked(rename)).toHaveBeenCalledWith(
      expect.stringContaining('.inventory-clerk.installing-'),
      '/Users/testuser/.uprow/employees/inventory-clerk',
    );
  });

  it('bypasses the Tauri HTTP proxy path for loopback package URLs', async () => {
    const archive = zipSync(entriesOf({
      '.codebuddy-plugin/plugin.json': JSON.stringify({
        name: 'local-test-clerk',
        agentName: 'local-test-clerk',
        version: '0.1.0',
        agents: ['./agents/local-test-clerk.md'],
      }),
      'agents/local-test-clerk.md': 'Validate local package delivery.',
    }));
    vi.mocked(fetch).mockClear();
    const browserFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(archive, { status: 200 }));

    await installFromDeepLink({
      action: 'install',
      pkgType: 'employee',
      url: 'http://127.0.0.1:3102/api/skills/local-test-clerk/zip',
      packageId: 'local-test-clerk',
      packageVersion: '0.1.0',
    });

    expect(browserFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3102/api/skills/local-test-clerk/zip',
      { method: 'GET' },
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    browserFetch.mockRestore();
  });

  it('rejects an unsigned employee archive when the platform requires integrity', async () => {
    const archive = zipSync(entriesOf({
      '.codebuddy-plugin/plugin.json': JSON.stringify({
        name: 'unsigned-clerk',
        agentName: 'unsigned-clerk',
        version: '0.1.0',
      }),
    }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(archive, { status: 200 }));

    await expect(installFromDeepLink({
      action: 'install',
      pkgType: 'employee',
      url: 'https://abu-agent.oss-cn-beijing.aliyuncs.com/employees/unsigned-clerk.zip',
      integrityRequired: true,
    })).rejects.toMatchObject({ code: 'PACKAGE_SIGNATURE_REQUIRED' });
  });

  describe('planEmployeeUnpack', () => {
    it('preserves generic package identity and first-launch metadata', () => {
      const plugin = JSON.stringify({
        ...JSON.parse(PLUGIN_JSON),
        version: '1.2.3',
        defaultInitPrompt: { en: 'Start the first generic task.' },
      });
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': plugin,
          'agents/new-media-ops.md': 'prompt',
        }),
      );

      expect(plan.packageId).toBe('new-media-ops');
      expect(plan.packageVersion).toBe('1.2.3');
      expect(plan.defaultInitPrompt?.en).toBe('Start the first generic task.');
    });

    it('plans a root-level package and keeps the dot-prefixed manifest dir', () => {
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': PLUGIN_JSON,
          'agents/new-media-ops.md': '---\nname: x\n---\nprompt',
          'avatars/expert.png': 'png-bytes',
        }),
      );
      expect(plan.name).toBe('new-media-ops');
      expect(plan.audit.level).toBe('L0');
      expect(plan.runtimeProfile).toBeUndefined();
      expect(plan.files.map((f) => f.path).sort()).toEqual([
        '.codebuddy-plugin/plugin.json',
        'agents/new-media-ops.md',
        'avatars/expert.png',
      ]);
    });

    it('carries runtime templates and maturity audit into the install result', () => {
      const runtimePlugin = JSON.stringify({
        ...JSON.parse(PLUGIN_JSON),
        skills: ['./skills/content-diagnosis'],
        runtime: {
          version: 1,
          targetMaturity: 'L2',
          memory: { scope: 'project', autoCapture: ['feedback'] },
          workflows: [
            {
              id: 'weekly-review',
              kind: 'schedule',
              name: '每周复盘',
              prompt: '执行每周复盘',
              schedule: { frequency: 'weekly', dayOfWeek: 3, time: { hour: 9, minute: 0 } },
            },
          ],
        },
      });
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': runtimePlugin,
          'agents/new-media-ops.md': 'prompt',
          'skills/content-diagnosis/SKILL.md': '---\nname: content-diagnosis\n---\nbody',
        }),
      );

      expect(plan.runtimeProfile?.workflows?.[0]).toEqual(
        expect.objectContaining({ id: 'weekly-review', kind: 'schedule' }),
      );
      expect(plan.audit.level).toBe('L2');
    });

    it('strips a single nested directory prefix (zip created from parent dir)', () => {
      const plan = planEmployeeUnpack(
        entriesOf({
          'new-media-ops/.codebuddy-plugin/plugin.json': PLUGIN_JSON,
          'new-media-ops/agents/new-media-ops.md': 'prompt',
          'stray-root-file.txt': 'outside the package, dropped',
        }),
      );
      expect(plan.name).toBe('new-media-ops');
      expect(plan.files.map((f) => f.path).sort()).toEqual([
        '.codebuddy-plugin/plugin.json',
        'agents/new-media-ops.md',
      ]);
    });

    it('falls back to plugin "name" when agentName is missing', () => {
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': JSON.stringify({ name: 'content-creator' }),
        }),
      );
      expect(plan.name).toBe('content-creator');
    });

    it('skips junk segments but keeps other dot entries', () => {
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': PLUGIN_JSON,
          'node_modules/x/index.js': 'junk',
          '__pycache__/a.pyc': 'junk',
          '.git/config': 'junk',
          '.DS_Store': 'junk',
          'skills/x/SKILL.md': 'keep',
        }),
      );
      expect(plan.files.map((f) => f.path).sort()).toEqual([
        '.codebuddy-plugin/plugin.json',
        'skills/x/SKILL.md',
      ]);
    });

    it('throws NO_PLUGIN_JSON without a manifest', () => {
      expect(() => planEmployeeUnpack(entriesOf({ 'agents/a.md': 'x' }))).toThrowError(
        expect.objectContaining({ code: 'NO_PLUGIN_JSON' }) as Error,
      );
    });

    it('throws NO_NAME on malformed or nameless plugin.json', () => {
      expect(() =>
        planEmployeeUnpack(entriesOf({ '.codebuddy-plugin/plugin.json': 'not json' })),
      ).toThrowError(expect.objectContaining({ code: 'NO_NAME' }) as Error);
      expect(() =>
        planEmployeeUnpack(entriesOf({ '.codebuddy-plugin/plugin.json': '{}' })),
      ).toThrowError(expect.objectContaining({ code: 'NO_NAME' }) as Error);
    });

    it('rejects names that are unsafe as directory components', () => {
      expect(() =>
        planEmployeeUnpack(
          entriesOf({
            '.codebuddy-plugin/plugin.json': JSON.stringify({ agentName: '../escape' }),
          }),
        ),
      ).toThrowError(DeepLinkInstallError);
    });

    it('rejects the reserved default agent name "abu"', () => {
      expect(() =>
        planEmployeeUnpack(
          entriesOf({ '.codebuddy-plugin/plugin.json': JSON.stringify({ agentName: 'abu' }) }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'RESERVED_NAME' }) as Error);
    });

    it('rejects path traversal inside the archive', () => {
      expect(() =>
        planEmployeeUnpack(
          entriesOf({
            '.codebuddy-plugin/plugin.json': PLUGIN_JSON,
            '../outside.txt': 'evil',
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'PATH_TRAVERSAL' }) as Error);
    });

    it('keeps legit filenames containing consecutive dots (segment-wise .. check)', () => {
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': PLUGIN_JSON,
          'skills/x/chapter1..2.md': 'keep',
          'skills/x/notes...txt': 'keep',
        }),
      );
      expect(plan.files.map((f) => f.path).sort()).toEqual([
        '.codebuddy-plugin/plugin.json',
        'skills/x/chapter1..2.md',
        'skills/x/notes...txt',
      ]);
    });

    it('normalizes backslash separators from Windows-built archives', () => {
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin\\plugin.json': PLUGIN_JSON,
          'agents\\new-media-ops.md': 'prompt',
        }),
      );
      expect(plan.name).toBe('new-media-ops');
      expect(plan.files.map((f) => f.path).sort()).toEqual([
        '.codebuddy-plugin/plugin.json',
        'agents/new-media-ops.md',
      ]);
    });

    it('extracts modelConfig and blanks api keys in the on-disk plugin.json', () => {
      const withModel = JSON.stringify({
        ...JSON.parse(PLUGIN_JSON),
        modelConfig: {
          provider: {
            apiFormat: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            model: 'deepseek-v3',
            apiKey: 'sk-maker-secret',
          },
          imageGen: { baseUrl: 'https://img.example.com', model: 'img-1', apiKey: 'sk-img-secret' },
        },
      });
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': withModel,
          'agents/new-media-ops.md': 'prompt',
        }),
      );

      // Live config (with key) is surfaced to the installer…
      expect(plan.modelConfig?.provider.apiKey).toBe('sk-maker-secret');
      // …but the bytes written to disk carry blanked keys only.
      const manifestEntry = plan.files.find((f) => f.path === '.codebuddy-plugin/plugin.json')!;
      const onDisk = new TextDecoder().decode(manifestEntry.data);
      expect(onDisk).not.toContain('sk-maker-secret');
      expect(onDisk).not.toContain('sk-img-secret');
      expect(JSON.parse(onDisk).modelConfig.provider.model).toBe('deepseek-v3');
    });

    it('does not throw on a malformed modelConfig: no injection, records a gap', () => {
      const withBadModel = JSON.stringify({
        ...JSON.parse(PLUGIN_JSON),
        modelConfig: {}, // no provider — would crash a naive .provider.apiKey access
      });
      let plan!: ReturnType<typeof planEmployeeUnpack>;
      expect(() => {
        plan = planEmployeeUnpack(
          entriesOf({
            '.codebuddy-plugin/plugin.json': withBadModel,
            'agents/new-media-ops.md': 'prompt',
          }),
        );
      }).not.toThrow();

      // Malformed config is not surfaced for injection…
      expect(plan.modelConfig).toBeUndefined();
      // …and a non-blocking gap is recorded.
      expect(plan.audit.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            owner: 'employee-package',
            code: 'INVALID_MODEL_CONFIG',
            blocking: false,
          }),
        ]),
      );
    });

    it('rejects oversized files', () => {
      const big = new Uint8Array(10 * 1024 * 1024 + 1);
      expect(() =>
        planEmployeeUnpack({
          '.codebuddy-plugin/plugin.json': strToU8(PLUGIN_JSON),
          'huge.bin': big,
        }),
      ).toThrowError(expect.objectContaining({ code: 'FILE_TOO_LARGE' }) as Error);
    });
  });
});
