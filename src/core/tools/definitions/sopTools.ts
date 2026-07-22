/**
 * SOP tools — deterministic advancement surface for structured SOPs.
 *
 * `sop_advance` is the only way the agent can mark a SOP node done.
 * Validation lives in core/skill/sop.ts (advanceSop); an illegal
 * node/outcome is rejected without state change, which forces the model
 * back to the actual current node. Writes state → not concurrency-safe
 * (default fail-closed, so isConcurrencySafe is omitted).
 */

import type { ToolDefinition } from '@/types';
import { TOOL_NAMES } from '../toolNames';
import { useChatStore } from '@/stores/chatStore';
import { useSopStore } from '@/stores/sopStore';
import { advanceSop, formatSopForPrompt, getActiveSopRun } from '@/core/skill/sop';

export const sopAdvanceTool: ToolDefinition = {
  name: TOOL_NAMES.SOP_ADVANCE,
  description:
    '推进当前会话的结构化 SOP：上报当前节点的执行结果并进入下一节点。SOP 激活时每个节点完成后都必须调用本工具落账，未落账的节点视为未完成。无法继续时传 abort=true 中止整个 SOP。',
  inputSchema: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: '当前节点 id（必须与 SOP 状态中的当前节点一致）' },
      outcome: { type: 'string', description: '该节点的执行结果，必须是节点 outcomes 声明中的值' },
      evidence: { type: 'string', description: '一句话证据（做了什么/产物在哪），不要贴原始输出' },
      abort: { type: 'boolean', description: '传 true 时中止整个 SOP（node_id/outcome 可省略），需在 evidence 里说明原因' },
    },
    required: [],
  },
  execute: async (input, context) => {
    const conversationId = context?.conversationId ?? useChatStore.getState().activeConversationId;
    if (!conversationId) return '错误：无法确定当前会话，SOP 状态未变更。';

    const run = getActiveSopRun(conversationId);
    if (!run) return '当前会话没有激活的 SOP，无需调用 sop_advance。';

    const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';

    if (input.abort === true) {
      useSopStore.getState().setRun(conversationId, {
        ...run,
        status: 'aborted',
        updatedAt: Date.now(),
      });
      return `SOP「${run.definition.name}」已中止。原因：${evidence || '未说明'}`;
    }

    const nodeId = typeof input.node_id === 'string' ? input.node_id.trim() : '';
    const outcome = typeof input.outcome === 'string' ? input.outcome.trim() : '';
    if (!nodeId || !outcome) return '错误：需要 node_id 与 outcome（或 abort=true）。SOP 状态未变更。';
    if (!evidence) return '错误：需要一句话 evidence 说明该节点做了什么。SOP 状态未变更。';

    const result = advanceSop(run, nodeId, outcome, evidence);
    if (!result.ok) return `推进被拒绝：${result.error}`;

    useSopStore.getState().setRun(conversationId, result.run);
    if (result.finished) {
      return `节点 ${nodeId} 已落账（${outcome}）。SOP「${run.definition.name}」全部节点完成 ✅（共 ${result.run.completed.length} 步）。`;
    }
    return `节点 ${nodeId} 已落账（${outcome}）。\n${formatSopForPrompt(conversationId)}`;
  },
};
