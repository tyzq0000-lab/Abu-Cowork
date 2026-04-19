import { describe, it, expect } from 'vitest';
import { isCategoryBlock, parseCategoryBlock } from './categoryBlocks';
import type { MemoryHeader } from '../memdir/types';

function makeHeader(overrides: Partial<MemoryHeader> = {}): MemoryHeader {
  return {
    filename: 'feedback_test.md',
    filePath: '/tmp/feedback_test.md',
    name: '不要主动为类似 "weekly-digest" 的任务建议 skill',
    description: '用户拒绝了 skill 提议',
    type: 'feedback',
    source: 'agent_explicit',
    created: 1_700_000_000_000,
    updated: 1_700_000_000_000,
    accessCount: 0,
    ...overrides,
  };
}

describe('isCategoryBlock', () => {
  it('matches a valid reject-category memory', () => {
    expect(isCategoryBlock(makeHeader())).toBe(true);
  });

  it('rejects memories of the wrong type', () => {
    expect(isCategoryBlock(makeHeader({ type: 'user' }))).toBe(false);
    expect(isCategoryBlock(makeHeader({ type: 'project' }))).toBe(false);
    expect(isCategoryBlock(makeHeader({ type: 'reference' }))).toBe(false);
  });

  it('rejects memories with wrong source (auto-extracted feedback etc.)', () => {
    // Auto-flushed feedback (source=auto_flush) could happen to match
    // the name regex by coincidence — require explicit agent_explicit
    // so only cards trigger this surface.
    expect(isCategoryBlock(makeHeader({ source: 'auto_flush' }))).toBe(false);
    expect(isCategoryBlock(makeHeader({ source: 'user_manual' }))).toBe(false);
  });

  it('rejects feedback memories with unrelated names', () => {
    expect(
      isCategoryBlock(makeHeader({ name: '不要直接使用 production 数据库' })),
    ).toBe(false);
    expect(isCategoryBlock(makeHeader({ name: '集成测试必须打真实数据库' }))).toBe(false);
  });

  it('rejects memories that contain but do not exactly match the pattern', () => {
    // Prefix match isn't enough — must be the full name string.
    expect(
      isCategoryBlock(
        makeHeader({ name: '[legacy] 不要主动为类似 "weekly-digest" 的任务建议 skill' }),
      ),
    ).toBe(false);
  });
});

describe('parseCategoryBlock', () => {
  it('extracts the blocked skill name', () => {
    const entry = parseCategoryBlock(makeHeader());
    expect(entry).toEqual({
      skillName: 'weekly-digest',
      filename: 'feedback_test.md',
      createdAt: 1_700_000_000_000,
      description: '用户拒绝了 skill 提议',
    });
  });

  it('handles skill names with special characters (hyphens, unicode)', () => {
    const entry = parseCategoryBlock(
      makeHeader({ name: '不要主动为类似 "周报-生成器-v2" 的任务建议 skill' }),
    );
    expect(entry?.skillName).toBe('周报-生成器-v2');
  });

  it('returns null for memories that do not match the pattern', () => {
    expect(parseCategoryBlock(makeHeader({ name: '不相关的记忆' }))).toBeNull();
  });

  it('uses the regex capture greedily-but-safely (stops at last quote)', () => {
    // Defensive: a skill name can't contain an unescaped `"` since the
    // writer controls that input (comes from SKILL.md frontmatter),
    // but if it did, the lazy quantifier takes the first closing quote.
    const entry = parseCategoryBlock(
      makeHeader({ name: '不要主动为类似 "weekly" 的任务建议 skill' }),
    );
    expect(entry?.skillName).toBe('weekly');
  });
});
