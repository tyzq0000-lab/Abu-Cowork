import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs';
import {
  parsePluginJson,
  isImageAvatarPath,
  loadEmployeePackage,
  scanEmployees,
} from './employeeLoader';

// Synthetic CodeBuddy package fixture (subset of the real content-creator pkg).
const PLUGIN_JSON = JSON.stringify({
  name: 'content-creator',
  agentName: 'content-creator',
  agents: ['./agents/content-creator.md'],
  displayName: { en: 'Kai', zh: '文爆爆' },
  profession: { en: 'Content Creator', zh: '内容创作专家' },
  displayDescription: { en: 'Crafts multi-platform content', zh: '擅长创作多平台内容' },
  avatar: 'avatars/expert.png',
  categoryId: '06-ContentCreative',
  tags: [
    { zh: '内容策略', en: 'Content Strategy' },
    { zh: '品牌叙事', en: 'Brand Storytelling' },
  ],
  quickPrompts: [
    { zh: '帮我制定内容策略', en: 'Help me build a content strategy' },
    { zh: '写一篇品牌长文', en: 'Write a brand long-form article' },
  ],
  skills: ['./skills/humanizer', './skills/novel-writer'],
});

const AGENT_MD = `---
name: content-creator
description: Expert content strategist
emoji: ✍️
---

# Content Creator Agent

You are Content Creator, an expert content strategist.`;

const PKG = '/Users/testuser/.uprow/employees/content-creator';

/** Wire readTextFile to return the right fixture per resolved path. */
function mockPackageFiles(overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    [`${PKG}/.codebuddy-plugin/plugin.json`]: PLUGIN_JSON,
    [`${PKG}/agents/content-creator.md`]: AGENT_MD,
    ...overrides,
  };
  vi.mocked(readTextFile).mockImplementation(async (path) => {
    const key = String(path);
    if (key in files) return files[key];
    throw new Error(`ENOENT: ${key}`);
  });
}

describe('employeeLoader', () => {
  beforeEach(() => {
    vi.mocked(readTextFile).mockReset();
    vi.mocked(readDir).mockReset();
    vi.mocked(exists).mockReset();
  });

  describe('parsePluginJson', () => {
    it('parses a valid object', () => {
      expect(parsePluginJson('{"agentName":"x"}')).toEqual({ agentName: 'x' });
    });
    it('returns null on malformed JSON', () => {
      expect(parsePluginJson('{not json')).toBeNull();
    });
    it('returns null on non-object root (array)', () => {
      expect(parsePluginJson('[1,2,3]')).toBeNull();
    });
  });

  describe('isImageAvatarPath', () => {
    it('detects image extensions', () => {
      expect(isImageAvatarPath('avatars/expert.png')).toBe(true);
      expect(isImageAvatarPath('/abs/path/a.JPG')).toBe(true);
    });
    it('treats emoji as non-image', () => {
      expect(isImageAvatarPath('✍️')).toBe(false);
      expect(isImageAvatarPath('🤖')).toBe(false);
    });
    it('handles undefined', () => {
      expect(isImageAvatarPath(undefined)).toBe(false);
    });
  });

  describe('loadEmployeePackage', () => {
    it('maps plugin.json + agent md into a SubagentDefinition', async () => {
      mockPackageFiles();
      const def = await loadEmployeePackage(PKG);
      expect(def).not.toBeNull();
      expect(def!.name).toBe('content-creator');
      expect(def!.source).toBe('employee');
      // zh is the default locale; en lives in the override maps
      expect(def!.description).toBe('擅长创作多平台内容');
      expect(def!.descriptions).toEqual({ 'en-US': 'Crafts multi-platform content' });
      expect(def!.displayNames).toEqual({ 'zh-CN': '文爆爆', 'en-US': 'Kai' });
      expect(def!.profession).toBe('内容创作专家');
      expect(def!.professionI18n).toEqual({ 'zh-CN': '内容创作专家', 'en-US': 'Content Creator' });
      expect(def!.tags).toEqual(['内容策略', '品牌叙事']);
      expect(def!.tagsI18n).toEqual({ 'en-US': ['Content Strategy', 'Brand Storytelling'] });
      expect(def!.samplePrompts).toEqual(['帮我制定内容策略', '写一篇品牌长文']);
      expect(def!.category).toBe('06-ContentCreative');
      expect(def!.skills).toEqual(['humanizer', 'novel-writer']);
      // avatar resolves to an absolute, forward-slash path under the package
      expect(def!.avatar).toBe(`${PKG}/avatars/expert.png`);
      // system prompt is the agent-md body, frontmatter stripped
      expect(def!.systemPrompt).toContain('You are Content Creator');
      expect(def!.systemPrompt).not.toContain('emoji:');
    });

    it('falls back to agent-md emoji when plugin.avatar is absent', async () => {
      const noAvatar = JSON.stringify({
        agentName: 'content-creator',
        agents: ['./agents/content-creator.md'],
        displayName: { zh: '文爆爆' },
      });
      mockPackageFiles({ [`${PKG}/.codebuddy-plugin/plugin.json`]: noAvatar });
      const def = await loadEmployeePackage(PKG);
      expect(def!.avatar).toBe('✍️');
    });

    it('uses the package runtime memory scope instead of forcing session memory', async () => {
      const persistentEmployee = JSON.stringify({
        ...JSON.parse(PLUGIN_JSON),
        runtime: {
          version: 1,
          targetMaturity: 'L2',
          memory: {
            scope: 'project',
            autoCapture: ['feedback', 'failure'],
          },
          workflows: [
            {
              id: 'weekly-review',
              kind: 'schedule',
              name: '每周复盘',
              prompt: '执行每周复盘',
              schedule: { frequency: 'weekly', dayOfWeek: 3 },
            },
          ],
        },
      });
      mockPackageFiles({
        [`${PKG}/.codebuddy-plugin/plugin.json`]: persistentEmployee,
      });

      const def = await loadEmployeePackage(PKG);

      expect(def!.memory).toBe('project');
    });

    it('returns null when plugin.json is missing', async () => {
      vi.mocked(readTextFile).mockRejectedValue(new Error('ENOENT'));
      expect(await loadEmployeePackage(PKG)).toBeNull();
    });

    it('returns null when plugin.json has no name/agentName', async () => {
      mockPackageFiles({ [`${PKG}/.codebuddy-plugin/plugin.json`]: '{"displayName":{"zh":"x"}}' });
      expect(await loadEmployeePackage(PKG)).toBeNull();
    });

    it('keeps an empty prompt when the agent md is unreadable', async () => {
      vi.mocked(readTextFile).mockImplementation(async (path) => {
        const key = String(path);
        if (key === `${PKG}/.codebuddy-plugin/plugin.json`) return PLUGIN_JSON;
        throw new Error(`ENOENT: ${key}`);
      });
      const def = await loadEmployeePackage(PKG);
      expect(def).not.toBeNull();
      expect(def!.systemPrompt).toBe('');
    });
  });

  describe('scanEmployees', () => {
    const ROOT = '/Users/testuser/.uprow/employees';

    it('returns [] when the root does not exist', async () => {
      vi.mocked(exists).mockResolvedValue(false);
      expect(await scanEmployees(ROOT)).toEqual([]);
    });

    it('loads valid packages and skips non-package directories', async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readDir).mockResolvedValue([
        { name: 'content-creator', isDirectory: true, isFile: false, isSymlink: false },
        { name: 'not-a-package', isDirectory: true, isFile: false, isSymlink: false },
        { name: 'README.md', isDirectory: false, isFile: true, isSymlink: false },
      ] as Awaited<ReturnType<typeof readDir>>);
      mockPackageFiles(); // only content-creator's files resolve; others throw
      const result = await scanEmployees(ROOT);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('content-creator');
    });
  });
});
