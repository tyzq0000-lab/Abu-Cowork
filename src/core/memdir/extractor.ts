/**
 * Memory Extractor — automatically extract durable memories from conversations.
 *
 * Triggered when an IM session switches (timeout or "新对话").
 * Makes a lightweight LLM call to identify key facts worth remembering,
 * then writes them as structured memory entries.
 *
 * Inspired by OpenClaw's pre-compaction memory flush, but uses a dedicated
 * extraction prompt instead of a full agent turn (cheaper and more controlled).
 */

import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore, getActiveApiKey, getActiveProvider, getEffectiveModel } from '../../stores/settingsStore';
import { ClaudeAdapter } from '../llm/claude';
import { OpenAICompatibleAdapter } from '../llm/openai-compatible';
import type { LLMAdapter } from '../llm/adapter';
import type { AgentMemoryCapture, StreamEvent } from '../../types';
import type { Message } from '../../types';
import type { MemoryType } from '../memdir/types';
import { resolvePlatformRelayExecution } from '../employee/platformRelay';

interface ExtractedMemory {
  name: string;
  content: string;
  type?: MemoryType;
  capture?: AgentMemoryCapture;
  /**
   * Optional. When set, the writer will delete the referenced filename before
   * writing the new entry — used to atomically replace an outdated/conflicting
   * memory rather than producing a near-duplicate alongside it.
   */
  _replaces?: string;
}

export interface MemoryExtractionOptions {
  /** Employee-private memdir key. When present, global/workspace memory is never scanned. */
  memoryPath?: string;
  allowedCaptures?: AgentMemoryCapture[];
  writeMode?: 'auto' | 'approval';
  agentName?: string;
  mode?: 'conversation' | 'dream';
  /** Prebuilt multi-session transcript used by Dream. */
  transcript?: string;
}

export interface MemoryExtractionResult {
  candidates: number;
  written: number;
  proposed: number;
  safetyBlocked: number;
  replaced: number;
}

const EMPTY_RESULT: MemoryExtractionResult = {
  candidates: 0,
  written: 0,
  proposed: 0,
  safetyBlocked: 0,
  replaced: 0,
};

const CAPTURE_TO_TYPE: Record<AgentMemoryCapture, MemoryType> = {
  preference: 'user',
  feedback: 'feedback',
  failure: 'feedback',
  project: 'project',
  reference: 'reference',
};

const MEMORY_TYPES = new Set<MemoryType>(['user', 'feedback', 'project', 'reference']);

export function normalizeExtractedMemory(
  value: unknown,
  allowedCaptures?: readonly AgentMemoryCapture[],
): (ExtractedMemory & { type: MemoryType }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const memory = value as ExtractedMemory;
  if (typeof memory.name !== 'string' || !memory.name.trim()) return null;
  if (typeof memory.content !== 'string' || !memory.content.trim()) return null;

  if (allowedCaptures) {
    if (!memory.capture || !allowedCaptures.includes(memory.capture)) return null;
    return { ...memory, name: memory.name.trim(), content: memory.content.trim(), type: CAPTURE_TO_TYPE[memory.capture] };
  }
  if (!memory.type || !MEMORY_TYPES.has(memory.type)) return null;
  return { ...memory, name: memory.name.trim(), content: memory.content.trim(), type: memory.type };
}

const EXTRACTION_SYSTEM_PROMPT = `你是一个记忆提取助手。分析给定的对话，提取值得长期记忆的信息。

## 类型说明（4 类）
- user: 用户习惯、偏好、角色、知识水平、工作流
- feedback: 用户对 AI 行为的纠正或确认（重点关注），格式：规则 + 原因（Why）+ 适用场景（How to apply）
- project: 项目动态、关键决策、重要结论、待办事项（注意：技术栈/架构/文件路径属于"可派生信息"，不要保存）
- reference: 外部系统指针（文档链接、看板地址、频道名）

## feedback 类型说明
当以下情况出现时，提取为 feedback：
- 用户纠正 AI 做法："不要这样"、"别用这个"、"下次先..."
- 用户确认非常规做法："对就这样"、"这个方式不错"
- 工具反复失败后，用户或 AI 总结了规避方法
feedback content 必须包含：规则本身 + Why（用户为什么这么要求）+ How to apply（什么场景下生效）

## ❌ 不要保存（重要：宁缺毋滥）

### 一次性任务结果（绝对不要）
反面教材（来自真实违规案例）：
- "claude_code 实践教程已整理"、"翻译完成"、"路线已规划"、"PPT 已导出"
- "整理了 N 个文件"、"X 已生成完成"、"Y 已成功"
判断标准：用过去时描述某件已完成的事 → 跳过。

### 临时状态（绝对不要）
反面教材：
- "API 密钥无效"、"端口被占用"、"服务连不上"
- "持久化功能测试成功"、"并发写入测试完成"、"X 测试通过"
判断标准：描述当前某个状态/系统是否正常 → 状态会变 → 跳过。

### 可派生信息（绝对不要）
反面教材：
- "项目位于 /Users/X"、"应用名叫 Y"、"项目用 Tauri/React"
- "代码在 N 处用了 Z 模式"、"用户电脑上安装了 X 应用"
判断标准：从工作区路径、package.json、grep 都能查到 → 跳过。

### 工具/接口/技能信息（绝对不要）
反面教材：
- "数易平台报表下载接口"、"数易平台报表下载任务状态"
- "数易平台定时下载报表列表"、"X 平台 Y 接口"
- "abu-browser-bridge 扩展用于获取浏览器标签页"（重复 3 次）
判断标准：描述某个工具/平台的接口/功能/用法 → 这属于 skill 系统职责 → 跳过。

### 索引中已有的内容
对话中如果出现的信息与"已有记忆索引"中某条相同或表达相同概念（即便用词不同），**不要重复提取**。

### 闲聊、问候、一次性查询
"你好"、"谢谢"、"今天天气如何"、"帮我算 1+1"、一般性新闻时事 —— 无持久价值。

## 三问筛查

对每条候选信息提问，三个都"是"才保存：
1. 这条信息**下次对话还有用**吗？（不是当前任务的临时事实）
2. 这条信息**无法从代码/工作区路径/项目配置文件推断**吗？
3. 这条信息**与索引中现有记忆不重复**吗？

任一个"否" → 跳过。

## 工具上下文
对话中 [工具] 标记表示工具调用及结果。工具偶发错误不提取；但失败导致用户纠正或 AI 总结了规避方法，应提取为 feedback。

## 处理冲突或更新（重要）

如果对话中有信息**与已有记忆索引冲突或更新**（如索引有"用户名为小包"，
对话里用户改口"我叫小白"；或索引有"用 npm"，用户改口"以后用 bun"），
输出时附 \`_replaces\` 字段引用要替换的 **filename**（来自已有索引）：

\`\`\`json
{
  "name": "用户名为小白",
  "content": "用户名为小白，希望被这样称呼",
  "type": "user",
  "_replaces": "user_用户名为_小包.md"
}
\`\`\`

写入逻辑会自动 **删除旧条 + 写入新条**，避免冲突的两条并存。

判断"是否冲突"：
- 同一事实不同值（名字、偏好、决策被推翻）→ 冲突，要 _replaces
- feedback 缺 Why/How，新对话补全了 → 替换为完整版本，要 _replaces
- 完全独立的新事实 → 普通 append（**不**要 _replaces）
- 近义但没新信息 → 跳过（**不**要输出）

## 规则
- 宁可返回 [] 也不要保存可疑内容
- 高质量 1 条胜于平庸 5 条
- 每条记忆必须独立、自包含
- 冲突时主动用 _replaces，**不要**留两条值矛盾的记忆并存
- 如果没有值得记忆的内容，返回空数组

输出格式：JSON 数组，每个元素：
{"name":"简短标题","content":"详细内容","type":"分类","_replaces":"可选-旧 filename"}

type 可选值: user, feedback, project, reference`;

function buildExtractionSystemPrompt(options: MemoryExtractionOptions): string {
  const additions: string[] = [];
  if (options.allowedCaptures) {
    additions.push(`## 员工包允许的自动记忆类别
本次只能提取以下 capture：${options.allowedCaptures.join(', ')}。
每个输出对象必须增加 \`capture\` 字段；不在允许列表中的候选必须丢弃。
映射规则：preference→user，feedback→feedback，failure→feedback，project→project，reference→reference。`);
  }
  if (options.mode === 'dream') {
    additions.push(`## 周期性自省模式
你正在分析该员工跨会话的历史记录。只提取反复出现、能改善未来工作的稳定模式；
不要复述单次任务结果，不要提出能力/工作流/触发器改动，只能产出长期记忆候选。`);
  }
  return additions.length > 0
    ? `${EXTRACTION_SYSTEM_PROMPT}\n\n${additions.join('\n\n')}`
    : EXTRACTION_SYSTEM_PROMPT;
}

/** Summarize tool calls on an assistant message for extraction context */
function summarizeToolCalls(message: Message): string {
  if (!message.toolCalls || message.toolCalls.length === 0) return '';
  return message.toolCalls
    .map(tc => {
      if (tc.isError) {
        const snippet = (tc.result ?? '').slice(0, 100);
        return `  [工具] ${tc.name} → 失败: ${snippet}`;
      }
      return `  [工具] ${tc.name} → 成功`;
    })
    .join('\n');
}

export function buildMemoryTranscript(messages: readonly Message[], maxMessages = 20): string {
  return messages
    .slice(-maxMessages)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const text = typeof message.content === 'string'
        ? message.content
        : (message.content as { type: string; text?: string }[])
            .filter((content) => content.type === 'text')
            .map((content) => content.text ?? '')
            .join('\n');
      const role = message.role === 'user' ? '用户' : 'AI';
      const toolSummary = message.role === 'assistant' ? summarizeToolCalls(message) : '';
      const line = `${role}: ${text.slice(0, 500)}`;
      return toolSummary ? `${line}\n${toolSummary}` : line;
    })
    .join('\n');
}

/**
 * Extract memories from a conversation.
 * Best-effort: failures are silently ignored.
 */
export async function extractMemoriesFromConversation(
  conversationId: string,
  workspacePath?: string | null,
  options: MemoryExtractionOptions = {},
): Promise<MemoryExtractionResult> {
  try {
    let transcript = options.transcript;
    if (!transcript) {
      const conv = useChatStore.getState().conversations[conversationId];
      const messages = conv?.messages ?? await (async () => {
        const { loadMessages } = await import('../session/conversationStorage');
        return loadMessages(conversationId);
      })();
      if (messages.length < 4) return { ...EMPTY_RESULT };
      transcript = buildMemoryTranscript(messages);
    }

    if (transcript.length < 50) return { ...EMPTY_RESULT };

    // Create adapter
    const settings = useSettingsStore.getState();
    const platformExecution = await resolvePlatformRelayExecution(conversationId);
    const executionProvider = platformExecution?.provider ?? getActiveProvider(settings);
    const activeApiKey = platformExecution?.provider.apiKey ?? getActiveApiKey(settings);
    if (!activeApiKey) {
      console.warn('[Memory] Auto-extraction skipped: no API key configured');
      return { ...EMPTY_RESULT };
    }

    const adapter: LLMAdapter = executionProvider?.apiFormat === 'openai-compatible'
      ? new OpenAICompatibleAdapter()
      : new ClaudeAdapter();

    // Inject existing memory manifest so the extractor can deduplicate against
    // what's already stored. Best-effort: failures fall through to extraction
    // without a manifest (worse dedup, but extraction still happens).
    const MAX_MANIFEST_LINES = 50;
    let manifestSection = '';
    const targetPath = options.memoryPath ?? workspacePath;
    try {
      const { scanMemoryFiles } = await import('./scan');
      const allHeaders = options.memoryPath
        ? await scanMemoryFiles(options.memoryPath)
        : [
            ...await scanMemoryFiles(null),
            ...(workspacePath ? await scanMemoryFiles(workspacePath) : []),
          ];
      if (allHeaders.length > 0) {
        // Include filename so the extractor can reference it in _replaces
        // when emitting a conflict-resolving update.
        const lines = allHeaders
          .slice(0, MAX_MANIFEST_LINES)
          .map(h => `- ${h.filename} [${h.type}]: ${h.description}`)
          .join('\n');
        manifestSection = `## 已有记忆索引（用于去重 + 引用 _replaces）\n${lines}\n\n`;
      }
    } catch {
      // Manifest is best-effort; skip if scan fails
    }

    // Make extraction call
    const extractionMessage: Message = {
      id: 'mem-extract',
      role: 'user',
      content: `${manifestSection}## ${options.mode === 'dream' ? '历史会话' : '对话'}\n${transcript}\n\n请分析以上内容并提取值得长期记忆的信息。先核对"已有记忆索引"避免重复，再按 system prompt 中的"三问筛查"判断是否值得保存。`,
      timestamp: Date.now(),
    };

    let responseText = '';
    await adapter.chat(
      [extractionMessage],
      {
        model: platformExecution?.modelId ?? getEffectiveModel(settings),
        apiKey: activeApiKey,
        baseUrl: executionProvider?.baseUrl || undefined,
        systemPrompt: buildExtractionSystemPrompt(options),
        maxTokens: 1024,
      },
      (event: StreamEvent) => {
        if (event.type === 'text') {
          responseText += event.text;
        }
      },
    );

    if (!responseText.trim()) return { ...EMPTY_RESULT };

    // Parse JSON from response (may be wrapped in ```json```)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { ...EMPTY_RESULT };

    let extracted: unknown[];
    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch {
      return { ...EMPTY_RESULT }; // malformed JSON
    }

    if (!Array.isArray(extracted) || extracted.length === 0) return { ...EMPTY_RESULT };

    const candidates = extracted
      .slice(0, 5)
      .map((memory) => normalizeExtractedMemory(memory, options.allowedCaptures))
      .filter((memory): memory is NonNullable<typeof memory> => !!memory);
    if (candidates.length === 0) return { ...EMPTY_RESULT };

    // Persist directly or create a durable Review Queue proposal, per package policy.
    const { writeMemory, deleteMemory } = await import('../memdir/write');
    const { ContentSafetyError } = await import('../safety/contentGuard');
    let written = 0;
    let proposed = 0;
    let safetyBlocked = 0;
    let replaced = 0;
    for (const mem of candidates) {
      if (options.writeMode === 'approval') {
        if (!options.memoryPath || !options.agentName) continue;
        try {
          const { createMemoryReviewProposal } = await import('../approval/reviewQueue');
          await createMemoryReviewProposal({
            conversationId,
            agentName: options.agentName,
            memoryPath: options.memoryPath,
            name: mem.name,
            description: mem.content.slice(0, 80),
            type: mem.type,
            content: mem.content,
            ...(typeof mem._replaces === 'string' ? { replaces: mem._replaces } : {}),
          });
          proposed++;
        } catch (err) {
          if (err instanceof ContentSafetyError) {
            safetyBlocked++;
            continue;
          }
          throw err;
        }
        continue;
      }

      // Handle _replaces: delete the conflicting old entry before writing
      // the new one. If delete fails (e.g. already gone) we still write the
      // new entry — best-effort. Skipping the new write would leave the user
      // worse off than before.
      if (mem._replaces && typeof mem._replaces === 'string') {
        try {
          await deleteMemory(mem._replaces, targetPath);
          replaced++;
          console.log(`[Memory] Replaced ${mem._replaces} with new entry "${mem.name}"`);
        } catch (err) {
          console.warn(`[Memory] Failed to delete ${mem._replaces} (proceeding with new entry):`, err);
        }
      }

      // Each write is independent: if one entry trips the scanner, skip it
      // and continue with the rest. Auto-extraction is best-effort — we
      // never abort the whole flush on a single bad entry.
      try {
        await writeMemory({
          name: mem.name,
          description: mem.content.slice(0, 80),
          type: mem.type,
          content: mem.content,
          source: 'auto_flush',
          workspacePath: targetPath,
        });
        written++;
      } catch (err) {
        if (err instanceof ContentSafetyError) {
          safetyBlocked++;
          console.warn(
            `[Memory] Auto-extraction skipped "${mem.name}" — content safety block:`,
            err.scan.findings.map((f) => f.patternId).join(', '),
          );
        } else {
          // Unexpected error — rethrow to outer catch for logging
          throw err;
        }
      }
    }

    if (written > 0 || proposed > 0) {
      const parts = [];
      if (proposed > 0) parts.push(`${proposed} proposed`);
      if (replaced > 0) parts.push(`${replaced} replaced`);
      if (safetyBlocked > 0) parts.push(`${safetyBlocked} blocked by safety scan`);
      const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      console.log(`[Memory] Extracted ${written + proposed} memories from conversation ${conversationId}${suffix}`);
    } else if (safetyBlocked > 0) {
      console.log(`[Memory] All ${safetyBlocked} extracted entries blocked by safety scan for ${conversationId}`);
    }
    return { candidates: candidates.length, written, proposed, safetyBlocked, replaced };
  } catch (err) {
    // Best-effort — never block session flow
    console.warn('[Memory] Extraction failed (non-critical):', err);
    return { ...EMPTY_RESULT };
  }
}
