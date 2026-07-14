import { describe, it, expect } from 'vitest';
import {
  buildAgentsMarkdown,
  buildCodexConfigToml,
  stripFrontmatter,
  type ContextHomeInput,
} from './contextHome';

const sampleSkill = {
  id: 'weekly-summary',
  name: 'weekly-summary',
  description: '把 CSV 明细按周汇总成 Markdown。',
  body: '---\nname: weekly-summary\ndescription: x\n---\n\n# 周汇总技能\n\n步骤：分组求和。',
};

const input: ContextHomeInput = {
  employeeName: '周报整理助手',
  personaMarkdown: '# 周报整理助手\n\n你只依据原始数据，不编造。',
  skills: [sampleSkill],
};

describe('contextHome', () => {
  describe('stripFrontmatter', () => {
    it('removes a leading YAML frontmatter block', () => {
      expect(stripFrontmatter('---\na: 1\n---\nbody')).toBe('body');
    });
    it('leaves markdown without frontmatter untouched', () => {
      expect(stripFrontmatter('# title\nbody')).toBe('# title\nbody');
    });
  });

  describe('buildAgentsMarkdown', () => {
    const md = buildAgentsMarkdown(input);

    it('carries the employee name and persona verbatim', () => {
      expect(md).toContain('# 周报整理助手');
      expect(md).toContain('你只依据原始数据，不编造。');
    });
    it('lists each skill and inlines its body without frontmatter', () => {
      expect(md).toContain('- **weekly-summary** — 把 CSV 明细按周汇总成 Markdown。');
      expect(md).toContain('### 技能：weekly-summary');
      expect(md).toContain('步骤：分组求和。');
      expect(md).not.toContain('name: weekly-summary'); // frontmatter stripped
    });
    it('renders （无） when there are no skills', () => {
      expect(buildAgentsMarkdown({ ...input, skills: [] })).toContain('（无）');
    });
  });

  describe('buildCodexConfigToml', () => {
    it('defaults to OpenAI (no provider block) with a [skills] section', () => {
      const toml = buildCodexConfigToml();
      expect(toml).not.toContain('model_provider');
      expect(toml).toContain('[skills]');
      expect(toml).toContain('include_instructions = true');
    });
    it('emits a custom OpenAI-compatible provider block', () => {
      const toml = buildCodexConfigToml({
        model: 'qwen-plus',
        provider: {
          id: 'dashscope',
          name: 'Aliyun DashScope',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          envKey: 'DASHSCOPE_API_KEY',
          wireApi: 'responses',
          supportsWebsockets: false,
        },
      });
      expect(toml).toContain('model = "qwen-plus"');
      expect(toml).toContain('model_provider = "dashscope"');
      expect(toml).toContain('[model_providers.dashscope]');
      expect(toml).toContain('wire_api = "responses"');
      expect(toml).toContain('supports_websockets = false');
    });
  });
});
