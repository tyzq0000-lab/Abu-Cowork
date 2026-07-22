/**
 * Structured SOP engine — SOP-as-data, deterministic advancement.
 *
 * A skill directory may carry an optional `sop.json` (a small node
 * graph, see SopDefinition in stores/sopStore). When such a skill is
 * activated, the SOP run is registered for the conversation; every turn
 * a dynamic prompt section shows the current node and progress, and the
 * agent must report each node's result via the `sop_advance` tool.
 * Advancement is validated by deterministic code here — an illegal
 * node/outcome is rejected and does not change state — so flow accuracy
 * does not depend on the model obeying prose. Zero extra LLM calls.
 *
 * Engine-agnostic by design: the SOP is package data; this module only
 * powers the native engine. Packages running engine='codex' fall back
 * to prompt-checklist semantics (no enforced ledger) for now.
 */

import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { joinPath } from '@/utils/pathUtils';
import { createLogger } from '@/core/logging/logger';
import {
  useSopStore,
  type SopDefinition,
  type SopNodeDef,
  type SopRunState,
} from '@/stores/sopStore';

const logger = createLogger('sop');

export const SOP_FILE_NAME = 'sop.json';

// --- Validation ---

export type SopParseResult =
  | { ok: true; sop: SopDefinition }
  | { ok: false; errors: string[] };

/**
 * Validate a raw parsed JSON value as a SopDefinition.
 * Graph integrity rules (mirrors the StaffDeck SkillCard validator idea,
 * re-implemented for our shape): non-empty unique node ids, start node
 * exists, outcomes non-empty, every `next` key is a declared outcome,
 * every `next` target exists, and at least one terminal outcome is
 * reachable (an outcome without a `next` mapping).
 */
export function parseSopDefinition(raw: unknown): SopParseResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['sop.json 根节点必须是对象'] };
  }
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) errors.push('缺少 name');

  const start = typeof obj.start === 'string' ? obj.start.trim() : '';
  if (!start) errors.push('缺少 start');

  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) {
    errors.push('nodes 必须是非空数组');
    return { ok: false, errors };
  }

  const nodes: SopNodeDef[] = [];
  for (let i = 0; i < obj.nodes.length; i++) {
    const n = obj.nodes[i] as Record<string, unknown>;
    const id = typeof n?.id === 'string' ? n.id.trim() : '';
    const title = typeof n?.title === 'string' ? n.title.trim() : '';
    const instruction = typeof n?.instruction === 'string' ? n.instruction.trim() : '';
    const outcomes = Array.isArray(n?.outcomes)
      ? (n.outcomes as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim() !== '')
      : [];
    if (!id) { errors.push(`nodes[${i}] 缺少 id`); continue; }
    if (!title) errors.push(`节点 ${id} 缺少 title`);
    if (!instruction) errors.push(`节点 ${id} 缺少 instruction`);
    if (outcomes.length === 0) errors.push(`节点 ${id} 的 outcomes 必须是非空字符串数组`);

    let next: Record<string, string> | undefined;
    if (n.next !== undefined) {
      if (typeof n.next !== 'object' || n.next === null || Array.isArray(n.next)) {
        errors.push(`节点 ${id} 的 next 必须是对象`);
      } else {
        next = {};
        for (const [outcome, target] of Object.entries(n.next as Record<string, unknown>)) {
          if (typeof target !== 'string' || !target.trim()) {
            errors.push(`节点 ${id} 的 next["${outcome}"] 必须是节点 id 字符串`);
            continue;
          }
          if (!outcomes.includes(outcome)) {
            errors.push(`节点 ${id} 的 next 键 "${outcome}" 不在 outcomes 声明中`);
          }
          next[outcome] = target.trim();
        }
      }
    }
    nodes.push({ id, title, instruction, outcomes, next });
  }

  // Cross-node graph checks
  const ids = nodes.map((n) => n.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length > 0) errors.push(`节点 id 重复: ${[...new Set(dup)].join(', ')}`);
  const idSet = new Set(ids);
  if (start && !idSet.has(start)) errors.push(`start "${start}" 不是已定义的节点`);
  let hasTerminal = false;
  for (const n of nodes) {
    for (const [outcome, target] of Object.entries(n.next ?? {})) {
      if (!idSet.has(target)) errors.push(`节点 ${n.id} 的 next["${outcome}"] 指向不存在的节点 "${target}"`);
    }
    if (n.outcomes.some((o) => !(n.next && o in n.next))) hasTerminal = true;
  }
  if (nodes.length > 0 && !hasTerminal) {
    errors.push('图中不存在终态：至少要有一个 outcome 不带 next 映射');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    sop: {
      name,
      version: typeof obj.version === 'string' ? obj.version : undefined,
      start,
      nodes,
    },
  };
}

// --- Run state helpers ---

export function getActiveSopRun(conversationId: string): SopRunState | undefined {
  const run = useSopStore.getState().runs[conversationId];
  return run?.status === 'active' ? run : undefined;
}

/**
 * Activate the SOP carried by a skill, if any. Idempotent and fail-open:
 * a conversation with an in-flight active run keeps it (resume
 * semantics); an invalid or absent sop.json never breaks skill
 * activation — it just logs and returns.
 */
export async function maybeActivateSopForSkill(
  conversationId: string,
  skillName: string,
  skillDir: string,
): Promise<void> {
  try {
    if (getActiveSopRun(conversationId)) return;

    const sopPath = joinPath(skillDir, SOP_FILE_NAME);
    if (!(await exists(sopPath))) return;

    const rawText = await readTextFile(sopPath);
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawText);
    } catch {
      logger.warn('sop.json is not valid JSON, skipping SOP activation', { skillName, sopPath });
      return;
    }
    const parsed = parseSopDefinition(rawJson);
    if (!parsed.ok) {
      logger.warn('sop.json failed graph validation, skipping SOP activation', {
        skillName,
        errors: parsed.errors,
      });
      return;
    }

    const now = Date.now();
    useSopStore.getState().setRun(conversationId, {
      skillName,
      definition: parsed.sop,
      currentNodeId: parsed.sop.start,
      completed: [],
      status: 'active',
      startedAt: now,
      updatedAt: now,
    });
    logger.info('SOP activated', { conversationId, skillName, sop: parsed.sop.name });
  } catch (e) {
    // Fail-open: SOP is an enhancement layer; never block the skill.
    logger.warn('SOP activation failed', { skillName, error: String(e) });
  }
}

// --- Advancement (deterministic) ---

export type SopAdvanceResult =
  | { ok: true; run: SopRunState; finished: boolean; nextNode?: SopNodeDef }
  | { ok: false; error: string };

/**
 * Pure advance: validates node/outcome against the run's definition and
 * returns the new run state. Illegal transitions change nothing.
 */
export function advanceSop(
  run: SopRunState,
  nodeId: string,
  outcome: string,
  evidence: string,
): SopAdvanceResult {
  if (run.status !== 'active') {
    return { ok: false, error: `SOP「${run.definition.name}」已${run.status === 'completed' ? '完成' : '中止'}，无可推进节点` };
  }
  if (nodeId !== run.currentNodeId) {
    return { ok: false, error: `节点不匹配：当前节点是 "${run.currentNodeId}"，不是 "${nodeId}"。请按当前节点上报。` };
  }
  const node = run.definition.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return { ok: false, error: `节点 "${nodeId}" 不在 SOP 定义中` };
  }
  if (!node.outcomes.includes(outcome)) {
    return { ok: false, error: `结果 "${outcome}" 不在节点 "${nodeId}" 允许的结果中（允许：${node.outcomes.join(' / ')}）` };
  }

  const now = Date.now();
  const nextId = node.next?.[outcome];
  const completedEntry = { nodeId, outcome, evidence, at: now };
  if (!nextId) {
    return {
      ok: true,
      finished: true,
      run: {
        ...run,
        completed: [...run.completed, completedEntry],
        status: 'completed',
        updatedAt: now,
      },
    };
  }
  const nextNode = run.definition.nodes.find((n) => n.id === nextId);
  return {
    ok: true,
    finished: false,
    nextNode,
    run: {
      ...run,
      completed: [...run.completed, completedEntry],
      currentNodeId: nextId,
      updatedAt: now,
    },
  };
}

// --- Prompt injection ---

/**
 * Format the active SOP run for the per-turn dynamic prompt section.
 * Empty string when the conversation has no active run.
 */
export function formatSopForPrompt(conversationId: string): string {
  const run = getActiveSopRun(conversationId);
  if (!run) return '';

  const node = run.definition.nodes.find((n) => n.id === run.currentNodeId);
  if (!node) return '';

  const doneLines = run.completed.map(
    (c, i) => `${i + 1}. ✅ ${c.nodeId} → ${c.outcome}（${c.evidence}）`,
  );
  const lines = [
    `## 当前 SOP：${run.definition.name}（技能：${run.skillName}）`,
    doneLines.length > 0 ? `已完成节点：\n${doneLines.join('\n')}` : '尚未完成任何节点。',
    `**当前节点：${node.id} — ${node.title}**`,
    `指令：${node.instruction}`,
    `完成后必须调用 sop_advance 工具上报，outcome 只能取：${node.outcomes.join(' / ')}。`,
    '硬性约束：未通过 sop_advance 落账的节点视为未完成，不得声称任务完成；不得跳过节点或伪造 outcome；无法继续时用 abort 中止并说明原因。',
  ];
  return lines.join('\n');
}
