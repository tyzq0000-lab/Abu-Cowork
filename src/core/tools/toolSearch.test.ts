import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolDefinition } from '../../types';
import {
  classifyTools,
  searchTools,
  buildDeferredToolsSummary,
  resetSessionPromotions,
  promoteToolToSession,
  isSessionPromoted,
} from './toolSearch';
import { CORE_TOOL_NAMES } from './toolPrefetch';

function makeTool(name: string, description = `${name} tool`): ToolDefinition {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => 'ok',
  };
}

describe('toolSearch', () => {
  beforeEach(() => {
    resetSessionPromotions();
  });

  describe('classifyTools', () => {
    it('puts core tools into coreTools', () => {
      const coreName = Array.from(CORE_TOOL_NAMES)[0];
      const tools = [makeTool(coreName), makeTool('rare_tool')];
      const { coreTools, deferredTools } = classifyTools(tools, new Set());
      expect(coreTools.map(t => t.name)).toContain(coreName);
      expect(deferredTools.map(t => t.name)).toContain('rare_tool');
    });

    it('includes prefetched tools in coreTools', () => {
      const tools = [makeTool('manage_scheduled_task'), makeTool('rare_tool')];
      const { coreTools } = classifyTools(tools, new Set(['manage_scheduled_task']));
      expect(coreTools.map(t => t.name)).toContain('manage_scheduled_task');
    });

    it('includes session-promoted tools in coreTools', () => {
      promoteToolToSession('rare_tool');
      const tools = [makeTool('rare_tool')];
      const { coreTools, deferredTools } = classifyTools(tools, new Set());
      expect(coreTools.map(t => t.name)).toContain('rare_tool');
      expect(deferredTools).toHaveLength(0);
    });
  });

  describe('session promotions', () => {
    it('promotes and checks tools', () => {
      expect(isSessionPromoted('foo')).toBe(false);
      promoteToolToSession('foo');
      expect(isSessionPromoted('foo')).toBe(true);
    });

    it('resets promotions', () => {
      promoteToolToSession('foo');
      resetSessionPromotions();
      expect(isSessionPromoted('foo')).toBe(false);
    });
  });

  describe('searchTools', () => {
    const tools = [
      makeTool('manage_scheduled_task', '管理定时任务和计划任务'),
      makeTool('clipboard_read', '读取系统剪贴板内容'),
      makeTool('generate_image', '生成图片'),
      makeTool('read_file', '读取文件内容'),
    ];

    it('returns exact name match first', () => {
      const results = searchTools('clipboard_read', tools);
      expect(results[0].name).toBe('clipboard_read');
    });

    it('matches partial name', () => {
      const results = searchTools('clipboard', tools);
      expect(results[0].name).toBe('clipboard_read');
    });

    it('matches description keywords', () => {
      const results = searchTools('定时', tools);
      expect(results.some(r => r.name === 'manage_scheduled_task')).toBe(true);
    });

    it('returns empty for no match', () => {
      const results = searchTools('nonexistent_xyz', tools);
      expect(results).toHaveLength(0);
    });

    it('respects maxResults', () => {
      const results = searchTools('read', tools, 1);
      expect(results).toHaveLength(1);
    });

    it('returns empty for blank query', () => {
      expect(searchTools('', tools)).toHaveLength(0);
      expect(searchTools('  ', tools)).toHaveLength(0);
    });
  });

  describe('buildDeferredToolsSummary', () => {
    it('returns empty for no deferred tools', () => {
      expect(buildDeferredToolsSummary([])).toBe('');
    });

    it('builds summary with tool names and descriptions', () => {
      const tools = [makeTool('clipboard_read', '读取剪贴板'), makeTool('generate_image', '生成图片')];
      const summary = buildDeferredToolsSummary(tools);
      expect(summary).toContain('clipboard_read');
      expect(summary).toContain('generate_image');
      expect(summary).toContain('tool_search');
    });
  });
});
