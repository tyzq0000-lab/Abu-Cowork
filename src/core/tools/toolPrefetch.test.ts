import { describe, it, expect } from 'vitest';
import { CORE_TOOL_NAMES, prefetchTools, type PrefetchContext } from './toolPrefetch';

function makeCtx(overrides: Partial<PrefetchContext> = {}): PrefetchContext {
  return {
    userInput: '',
    computerUseEnabled: false,
    activeSkills: [],
    turnCount: 0,
    ...overrides,
  };
}

describe('toolPrefetch', () => {
  describe('CORE_TOOL_NAMES', () => {
    it('should contain 4 always-on core tools (shrunk from 13 in v0.18.6)', () => {
      // Smaller core = smaller baseline tokens. Previously-core tools
      // (write/edit/run_command/list/search/fetch/workspace/delegate) are
      // now deferred and reached via tool_search + prefetch rules.
      expect(CORE_TOOL_NAMES.size).toBe(4);
    });

    it('should include the always-needed essentials', () => {
      expect(CORE_TOOL_NAMES.has('read_file')).toBe(true);
      expect(CORE_TOOL_NAMES.has('web_search')).toBe(true);
      expect(CORE_TOOL_NAMES.has('use_skill')).toBe(true);
      expect(CORE_TOOL_NAMES.has('tool_search')).toBe(true);
    });

    it('should defer file-mutation and shell tools (loaded on keyword match)', () => {
      expect(CORE_TOOL_NAMES.has('write_file')).toBe(false);
      expect(CORE_TOOL_NAMES.has('edit_file')).toBe(false);
      expect(CORE_TOOL_NAMES.has('run_command')).toBe(false);
      expect(CORE_TOOL_NAMES.has('list_directory')).toBe(false);
    });

    it('should not include conditional tools', () => {
      expect(CORE_TOOL_NAMES.has('generate_image')).toBe(false);
      expect(CORE_TOOL_NAMES.has('computer')).toBe(false);
      expect(CORE_TOOL_NAMES.has('manage_scheduled_task')).toBe(false);
    });
  });

  describe('prefetchTools', () => {
    it('should return first-turn tools for generic input on turn 0', () => {
      const result = prefetchTools(makeCtx({ userInput: '你好', turnCount: 0 }));
      expect(result).toContain('report_plan');
      expect(result).toContain('get_system_info');
    });

    it('should return report_plan + todo_write on turn 1-3', () => {
      const result = prefetchTools(makeCtx({ userInput: '你好', turnCount: 1 }));
      expect(result).toContain('todo_write');
      expect(result).toContain('report_plan');
      expect(result).not.toContain('get_system_info');
    });

    it('should not return report_plan after turn 3', () => {
      const result = prefetchTools(makeCtx({ userInput: '你好', turnCount: 4 }));
      expect(result).not.toContain('report_plan');
    });

    it('should prefetch write_file on save-related keywords (v0.18.6 deferred)', () => {
      expect(prefetchTools(makeCtx({ userInput: '帮我写文件' }))).toContain('write_file');
      expect(prefetchTools(makeCtx({ userInput: '把结果保存到 output.txt' }))).toContain('write_file');
      expect(prefetchTools(makeCtx({ userInput: 'please write file foo.txt' }))).toContain('write_file');
    });

    it('should prefetch run_command on shell-related keywords', () => {
      expect(prefetchTools(makeCtx({ userInput: '运行命令 ls -la' }))).toContain('run_command');
      expect(prefetchTools(makeCtx({ userInput: '在终端跑一下 git status' }))).toContain('run_command');
    });

    it('should prefetch edit_file on edit-related keywords', () => {
      expect(prefetchTools(makeCtx({ userInput: '修改文件中的某段代码' }))).toContain('edit_file');
      expect(prefetchTools(makeCtx({ userInput: 'edit file foo.ts' }))).toContain('edit_file');
    });

    it('should prefetch list_directory on dir-related keywords', () => {
      expect(prefetchTools(makeCtx({ userInput: '列出当前目录的文件' }))).toContain('list_directory');
      expect(prefetchTools(makeCtx({ userInput: '看看里面有哪些文件' }))).toContain('list_directory');
    });

    it('should match schedule keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '帮我设置一个定时任务' }));
      expect(result).toContain('manage_scheduled_task');
    });

    it('should match trigger keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '创建一个 webhook 触发器' }));
      expect(result).toContain('manage_trigger');
    });

    it('should match file watch keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '监听文件变化' }));
      expect(result).toContain('manage_file_watch');
    });

    it('should match image keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '生成一张图片' }));
      expect(result).toContain('generate_image');
      expect(result).toContain('process_image');
    });

    it('should match clipboard keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '读取剪贴板内容' }));
      expect(result).toContain('clipboard_read');
      expect(result).toContain('clipboard_write');
    });

    it('should match skill/agent creation keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '帮我创建一个新技能' }));
      expect(result).toContain('skill_manage');
      expect(result).toContain('save_agent');
    });

    it('should match MCP keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '我需要一个 MCP 工具' }));
      expect(result).toContain('manage_mcp_server');
    });

    it('should match notify keywords', () => {
      const result = prefetchTools(makeCtx({ userInput: '完成后通知我' }));
      expect(result).toContain('system_notify');
    });

    it('should load computer tool when enabled', () => {
      const result = prefetchTools(makeCtx({ computerUseEnabled: true }));
      expect(result).toContain('computer');
    });

    it('should not load computer tool when disabled and no keywords', () => {
      const result = prefetchTools(makeCtx({ computerUseEnabled: false }));
      expect(result).not.toContain('computer');
    });

    it('should load computer tool via keyword even when disabled', () => {
      const result = prefetchTools(makeCtx({ computerUseEnabled: false, userInput: '帮我截屏看看' }));
      expect(result).toContain('computer');
    });

    it('should load read_skill_file when active skills exist', () => {
      const result = prefetchTools(makeCtx({
        activeSkills: [{ name: 'test', description: 'test', content: '' } as import('../../types').Skill],
      }));
      expect(result).toContain('read_skill_file');
    });

    it('should load log_task_completion after turn 2', () => {
      expect(prefetchTools(makeCtx({ turnCount: 1 }))).not.toContain('log_task_completion');
      expect(prefetchTools(makeCtx({ turnCount: 2 }))).not.toContain('log_task_completion');
      expect(prefetchTools(makeCtx({ turnCount: 3 }))).toContain('log_task_completion');
    });

    it('should deduplicate results', () => {
      const result = prefetchTools(makeCtx({ userInput: '图片图像照片' }));
      const imageCount = result.filter(t => t === 'generate_image').length;
      expect(imageCount).toBe(1);
    });

    it('should match case-insensitively', () => {
      const result = prefetchTools(makeCtx({ userInput: 'DALL-E image generation' }));
      expect(result).toContain('generate_image');
    });
  });
});
