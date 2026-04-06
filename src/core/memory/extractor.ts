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
import type { StreamEvent } from '../../types';
import type { Message } from '../../types';
import { getMemoryBackend } from './router';
import type { MemoryCategory } from './types';

interface ExtractedMemory {
  summary: string;
  content: string;
  category: MemoryCategory;
  keywords: string[];
}

const EXTRACTION_SYSTEM_PROMPT = `你是一个记忆提取助手。分析给定的对话，提取值得长期记忆的信息。

## 类型说明
- user_preference: 用户习惯、偏好、角色、工作流
- project_knowledge: 项目技术栈、架构、术语（scope 应为 project）
- conversation_fact: 对话中的关键结论
- decision: 重要决策及其理由
- action_item: 待办事项、后续行动
- feedback: 用户对 AI 行为的纠正或确认（重点关注）

## feedback 类型说明
当以下情况出现时，提取为 feedback：
- 用户纠正 AI 做法："不要这样"、"别用这个"、"下次先..."
- 用户确认非显然做法："对就这样"、"这个方式不错"
- 工具反复失败后，用户或 AI 总结了规避方法

content 格式：规则 + 原因 + 适用场景。

示例：
用户说"别用 run_command 直接删文件，太危险"
→ {"summary":"避免用 run_command 删除文件","content":"用户要求不要用 run_command 执行删除操作，认为风险高。应让用户手动确认。","category":"feedback","keywords":["run_command","删除","安全"]}

## 工具上下文
对话中 [工具] 标记表示工具调用及结果。工具偶发错误不需要提取，但如果失败导致了用户纠正或总结了规避方法，应提取为 feedback。

## 规则
- 只提取有持久价值的信息
- 忽略临时性内容（问候、闲聊、一次性查询）
- 每条记忆必须独立、自包含
- 如果没有值得记忆的内容，返回空数组

输出格式：JSON 数组，每个元素：
{"summary":"一句话摘要","content":"详细内容","category":"分类","keywords":["关键词"]}

category 可选值: user_preference, project_knowledge, conversation_fact, decision, action_item, feedback`;

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

/**
 * Extract memories from a conversation.
 * Best-effort: failures are silently ignored.
 */
export async function extractMemoriesFromConversation(
  conversationId: string,
  scope: 'user' | 'project' = 'user',
  projectPath?: string,
): Promise<void> {
  try {
    const conv = useChatStore.getState().conversations[conversationId];
    const messages = conv?.messages ?? await (async () => {
      const { loadMessages } = await import('../session/conversationStorage');
      return loadMessages(conversationId);
    })();
    if (messages.length < 4) return; // too short to extract

    // Build transcript from recent messages (last 20)
    const recentMsgs = messages.slice(-20);
    const transcript = recentMsgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const text = typeof m.content === 'string'
          ? m.content
          : (m.content as { type: string; text?: string }[])
              .filter(c => c.type === 'text')
              .map(c => c.text ?? '')
              .join('\n');
        const role = m.role === 'user' ? '用户' : 'AI';
        const toolSummary = m.role === 'assistant' ? summarizeToolCalls(m) : '';
        const line = `${role}: ${text.slice(0, 500)}`;
        return toolSummary ? `${line}\n${toolSummary}` : line;
      })
      .join('\n');

    if (transcript.length < 50) return; // too little content

    // Create adapter
    const settings = useSettingsStore.getState();
    const activeApiKey = getActiveApiKey(settings);
    if (!activeApiKey) {
      console.warn('[Memory] Auto-extraction skipped: no API key configured');
      return;
    }

    const adapter: LLMAdapter = getActiveProvider(settings)?.apiFormat === 'openai-compatible'
      ? new OpenAICompatibleAdapter()
      : new ClaudeAdapter();

    // Make extraction call
    const extractionMessage: Message = {
      id: 'mem-extract',
      role: 'user',
      content: `请分析以下对话并提取值得长期记忆的信息：\n\n${transcript}`,
      timestamp: Date.now(),
    };

    let responseText = '';
    await adapter.chat(
      [extractionMessage],
      {
        model: getEffectiveModel(settings),
        apiKey: activeApiKey,
        baseUrl: getActiveProvider(settings)?.baseUrl || undefined,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        maxTokens: 1024,
      },
      (event: StreamEvent) => {
        if (event.type === 'text') {
          responseText += event.text;
        }
      },
    );

    if (!responseText.trim()) return;

    // Parse JSON from response (may be wrapped in ```json```)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    let extracted: ExtractedMemory[];
    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch {
      return; // malformed JSON
    }

    if (!Array.isArray(extracted) || extracted.length === 0) return;

    // Write to memory backend
    const backend = getMemoryBackend();
    for (const mem of extracted.slice(0, 5)) { // max 5 entries per extraction
      if (!mem.summary || !mem.content || !mem.category) continue;

      await backend.add({
        category: mem.category,
        summary: mem.summary,
        content: mem.content,
        keywords: mem.keywords ?? [],
        sourceType: 'auto_flush',
        scope,
        projectPath,
      });
    }

    console.log(`[Memory] Extracted ${Math.min(extracted.length, 5)} memories from conversation ${conversationId}`);
  } catch (err) {
    // Best-effort — never block session flow
    console.warn('[Memory] Extraction failed (non-critical):', err);
  }
}
