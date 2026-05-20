/**
 * Conditional tool loading — reduces tool token overhead by only injecting
 * tools when they're likely needed based on user input keywords.
 *
 * Core tools (~16) are always loaded. Conditional tools (~14) are loaded
 * only when keyword matching or settings indicate they're needed.
 */

import type { Skill } from '../../types';
import { TOOL_NAMES } from './toolNames';

/**
 * Tools always present in every turn (~1200 tokens — shrunk from 13 to 7).
 *
 * Trade-off: previously we shipped 13 always-on tools (~3k tokens). For the
 * common "you ask Abu a casual question" turn, most of those tools were
 * never invoked but still cost tokens. Pushed file-mutation / OS-shell /
 * directory-listing / fetch / workspace / delegate to deferred; the model
 * reaches them via `tool_search` (one-line summaries are in the system
 * prompt's deferred-tools section).
 *
 * Keyword prefetch rules below auto-promote common cases back into the
 * core set (e.g. "写文件" → write_file) so this doesn't add a roundtrip
 * for typical agent tasks.
 */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.READ_FILE,        // read is by far the most common, keep core
  TOOL_NAMES.WEB_SEARCH,       // chat-only "search and answer" is common
  TOOL_NAMES.USE_SKILL,        // skill activation entry point
  TOOL_NAMES.TOOL_SEARCH,      // meta-tool for discovering deferred tools
]);

/** Keyword → tool mapping for demand-based loading */
const PREFETCH_RULES: ReadonlyArray<{
  keywords: readonly string[];
  tools: readonly string[];
}> = [
  // File mutation — pulled out of core in v0.18.6 to shrink baseline.
  // These rules re-promote on common phrasing so typical workflows
  // (write a file, edit, run command, list dir, search) don't pay the
  // extra tool_search roundtrip.
  {
    keywords: ['写文件', '写入', '保存到', '创建文件', '新建文件', '另存', 'write file', 'save to', 'save as'],
    tools: [TOOL_NAMES.WRITE_FILE],
  },
  {
    keywords: ['编辑文件', '修改文件', '替换', '改一下', 'edit file', 'modify file', 'replace'],
    tools: [TOOL_NAMES.EDIT_FILE],
  },
  {
    keywords: ['执行命令', '运行命令', '跑一下', '终端', 'shell', 'bash', 'run command', 'execute', '命令行', 'cli'],
    tools: [TOOL_NAMES.RUN_COMMAND],
  },
  {
    keywords: ['列出', '目录', '文件夹', '看看里面', 'ls ', 'dir ', 'list directory', '有哪些文件'],
    tools: [TOOL_NAMES.LIST_DIRECTORY],
  },
  {
    keywords: ['搜索文件', '查找文件', '内容搜索', '全文搜索', 'grep', 'search files'],
    tools: [TOOL_NAMES.SEARCH_FILES, TOOL_NAMES.FIND_FILES],
  },
  {
    keywords: ['下载', '抓取', '请求接口', 'http', 'fetch ', 'curl', 'api 调用'],
    tools: [TOOL_NAMES.HTTP_FETCH],
  },
  {
    keywords: ['工作区', '工作目录', 'workspace', '当前项目'],
    tools: [TOOL_NAMES.REQUEST_WORKSPACE],
  },
  {
    keywords: ['委托', '派代理', '让代理', 'delegate', 'sub-agent', '子代理', '同时调研', '并行做'],
    tools: [TOOL_NAMES.DELEGATE_TO_AGENT],
  },
  {
    keywords: ['定时', '计划', '每天', '每周', '自动执行', 'schedule', 'cron'],
    tools: [TOOL_NAMES.MANAGE_SCHEDULED_TASK],
  },
  {
    keywords: ['触发', '监听', '事件', '自动响应', 'trigger', 'webhook'],
    tools: [TOOL_NAMES.MANAGE_TRIGGER],
  },
  {
    keywords: ['文件变化', '文件监听', '新文件', 'watch'],
    tools: [TOOL_NAMES.MANAGE_FILE_WATCH],
  },
  {
    keywords: ['图片', '图像', '照片', '画', '生成图', 'image', 'dall'],
    tools: [TOOL_NAMES.GENERATE_IMAGE, TOOL_NAMES.PROCESS_IMAGE],
  },
  {
    keywords: ['缩放', '裁剪', '压缩图', '转换格式', 'resize', 'crop'],
    tools: [TOOL_NAMES.PROCESS_IMAGE],
  },
  {
    keywords: ['剪贴板', '粘贴板', '复制的', '粘贴', 'clipboard'],
    tools: [TOOL_NAMES.CLIPBOARD_READ, TOOL_NAMES.CLIPBOARD_WRITE],
  },
  {
    keywords: ['创建技能', '保存技能', '新技能', '修改技能', '创建代理', '新代理'],
    tools: [TOOL_NAMES.SKILL_MANAGE, TOOL_NAMES.SAVE_AGENT, TOOL_NAMES.TEST_SKILL_TRIGGER, TOOL_NAMES.IMPROVE_SKILL_DESCRIPTION],
  },
  {
    keywords: ['mcp', '工具服务', '缺少工具', '安装服务'],
    tools: [TOOL_NAMES.MANAGE_MCP_SERVER],
  },
  {
    keywords: ['之前', '上次', '最近', '记得', '回忆', '干了什么', '干了啥', '聊过', '做过', '历史', 'recall', '记忆'],
    tools: [TOOL_NAMES.RECALL],
  },
  {
    keywords: ['通知我', '提醒我', '完成后通知', 'notify'],
    tools: [TOOL_NAMES.SYSTEM_NOTIFY],
  },
  {
    keywords: ['截屏', '截图', '屏幕', '打开应用', '点击', '操控电脑', '操作电脑', '鼠标', '键盘', 'screenshot', 'click', 'computer use', '帮我打开', '帮我点'],
    tools: [TOOL_NAMES.COMPUTER],
  },
];

export interface PrefetchContext {
  userInput: string;
  computerUseEnabled: boolean;
  activeSkills: Skill[];
  turnCount: number;
}

/**
 * Determine which conditional tools should be loaded for this turn.
 *
 * Returns tool names to add on top of CORE_TOOL_NAMES.
 * Skill allowed-tools whitelist takes priority — when a skill defines
 * allowed-tools, prefetch is skipped entirely (handled by resolveTools).
 */
export function prefetchTools(ctx: PrefetchContext): string[] {
  const additionalTools: string[] = [];
  const lower = ctx.userInput.toLowerCase();

  // Keyword matching
  for (const rule of PREFETCH_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) {
      additionalTools.push(...rule.tools);
    }
  }

  // Computer use: load when enabled (auto-enabled on first call) OR via keyword prefetch
  if (ctx.computerUseEnabled) {
    additionalTools.push(TOOL_NAMES.COMPUTER);
  }

  // Active skill exists → may need read_skill_file
  if (ctx.activeSkills.length > 0) {
    additionalTools.push(TOOL_NAMES.READ_SKILL_FILE);
  }

  // Early turns: load planning + system info tools (LLM may plan after initial research)
  if (ctx.turnCount <= 3) {
    additionalTools.push(TOOL_NAMES.REPORT_PLAN);
  }
  if (ctx.turnCount === 0) {
    additionalTools.push(TOOL_NAMES.GET_SYSTEM_INFO);
  }

  // Non-first turns: load task tracking + memory tools
  if (ctx.turnCount > 0) {
    additionalTools.push(TOOL_NAMES.TODO_WRITE);
  }
  if (ctx.turnCount > 2) {
    additionalTools.push(TOOL_NAMES.LOG_TASK_COMPLETION);
    additionalTools.push(TOOL_NAMES.UPDATE_MEMORY);
  }

  return [...new Set(additionalTools)];
}
