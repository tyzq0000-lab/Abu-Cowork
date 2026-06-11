import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { planEmployeeUnpack, DeepLinkInstallError } from './installer';

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
  describe('planEmployeeUnpack', () => {
    it('plans a root-level package and keeps the dot-prefixed manifest dir', () => {
      const plan = planEmployeeUnpack(
        entriesOf({
          '.codebuddy-plugin/plugin.json': PLUGIN_JSON,
          'agents/new-media-ops.md': '---\nname: x\n---\nprompt',
          'avatars/expert.png': 'png-bytes',
        }),
      );
      expect(plan.name).toBe('new-media-ops');
      expect(plan.files.map((f) => f.path).sort()).toEqual([
        '.codebuddy-plugin/plugin.json',
        'agents/new-media-ops.md',
        'avatars/expert.png',
      ]);
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
