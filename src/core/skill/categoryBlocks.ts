/**
 * Helpers for identifying "reject-category" feedback memories.
 *
 * When a user clicks "这类别再提议" on a skill proposal card,
 * SkillProposalCard.handleRejectCategory writes a feedback memory with
 * a deterministic name pattern so future system prompts can see the
 * block (Module F's "create 前扫 feedback memory" guardrail).
 *
 * We use that same pattern here to filter scanMemoryFiles() output
 * into the "blocked categories" list the user can manage + undo.
 *
 * Name pattern (from SkillProposalCard.tsx):
 *   `不要主动为类似 "${skillName}" 的任务建议 skill`
 *
 * Keeping the regex and the writer co-located here would be cleaner
 * long-term, but the writer is in a React component whose commit
 * history would get noisy if we touched it; the string is stable
 * since both sides are internal.
 */

import type { MemoryHeader } from '../memdir/types';

const CATEGORY_BLOCK_NAME_RE = /^不要主动为类似 "(.+?)" 的任务建议 skill$/;

export interface CategoryBlockEntry {
  /** The blocked skill name, extracted from the memory's `name` field. */
  skillName: string;
  /** Memory filename — what deleteMemory() needs to revoke the block. */
  filename: string;
  /** When the block was created, so we can sort most-recent-first. */
  createdAt: number;
  /** Description from frontmatter — used as a secondary tooltip line. */
  description: string;
}

/**
 * Type guard + filter: returns true when a memory header is a
 * reject-category block written by the SkillProposalCard flow.
 *
 * Conservative on purpose — requires all three markers (type, source,
 * name pattern) to match, so unrelated feedback memories that happen
 * to mention "不要" won't be surfaced as unblockable entries.
 */
export function isCategoryBlock(header: MemoryHeader): boolean {
  return (
    header.type === 'feedback' &&
    header.source === 'agent_explicit' &&
    CATEGORY_BLOCK_NAME_RE.test(header.name)
  );
}

/**
 * Extract the blocked skill name from a category-block memory header.
 * Returns null if the header isn't a category block (caller should
 * filter with isCategoryBlock first — this returns null instead of
 * throwing so callers can use .map without a pre-filter).
 */
export function parseCategoryBlock(header: MemoryHeader): CategoryBlockEntry | null {
  const match = CATEGORY_BLOCK_NAME_RE.exec(header.name);
  if (!match) return null;
  return {
    skillName: match[1],
    filename: header.filename,
    createdAt: header.created,
    description: header.description,
  };
}
