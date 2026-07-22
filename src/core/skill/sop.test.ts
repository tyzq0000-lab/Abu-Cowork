import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import {
  parseSopDefinition,
  advanceSop,
  formatSopForPrompt,
  maybeActivateSopForSkill,
  getActiveSopRun,
} from './sop';
import { useSopStore, type SopDefinition, type SopRunState } from '@/stores/sopStore';

// A minimal legal graph: a --ok--> b(terminal).
const validDef: SopDefinition = {
  name: '测试流程',
  version: '1',
  start: 'a',
  nodes: [
    { id: 'a', title: '节点A', instruction: '做A', outcomes: ['ok'], next: { ok: 'b' } },
    { id: 'b', title: '节点B', instruction: '做B', outcomes: ['done'] },
  ],
};

function makeRun(overrides?: Partial<SopRunState>): SopRunState {
  return {
    skillName: 'core-workflow',
    definition: validDef,
    currentNodeId: 'a',
    completed: [],
    status: 'active',
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('parseSopDefinition', () => {
  it('accepts a legal graph', () => {
    const r = parseSopDefinition(validDef);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.sop.name).toBe('测试流程');
    expect(r.sop.start).toBe('a');
    expect(r.sop.nodes).toHaveLength(2);
  });

  it('rejects a non-object root', () => {
    for (const bad of ['string', 42, null, [] as unknown]) {
      const r = parseSopDefinition(bad);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected fail');
      expect(r.errors.some((e) => e.includes('根节点必须是对象'))).toBe(true);
    }
  });

  it('rejects missing name', () => {
    const r = parseSopDefinition({ start: 'a', nodes: validDef.nodes });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('缺少 name'))).toBe(true);
  });

  it('rejects missing start', () => {
    const r = parseSopDefinition({ name: 'x', nodes: validDef.nodes });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('缺少 start'))).toBe(true);
  });

  it('rejects empty nodes', () => {
    const r = parseSopDefinition({ name: 'x', start: 'a', nodes: [] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('nodes 必须是非空数组'))).toBe(true);
  });

  it('rejects duplicate node ids', () => {
    const r = parseSopDefinition({
      name: 'x',
      start: 'a',
      nodes: [
        { id: 'a', title: 'A', instruction: 'i', outcomes: ['ok'], next: { ok: 'a' } },
        { id: 'a', title: 'A2', instruction: 'i', outcomes: ['done'] },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('节点 id 重复'))).toBe(true);
  });

  it('rejects start pointing to a nonexistent node', () => {
    const r = parseSopDefinition({ name: 'x', start: 'ghost', nodes: validDef.nodes });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('不是已定义的节点'))).toBe(true);
  });

  it('rejects a next key not declared in outcomes', () => {
    const r = parseSopDefinition({
      name: 'x',
      start: 'a',
      nodes: [
        { id: 'a', title: 'A', instruction: 'i', outcomes: ['ok'], next: { bogus: 'b' } },
        { id: 'b', title: 'B', instruction: 'i', outcomes: ['done'] },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('不在 outcomes 声明中'))).toBe(true);
  });

  it('rejects a next target that does not exist', () => {
    const r = parseSopDefinition({
      name: 'x',
      start: 'a',
      nodes: [
        { id: 'a', title: 'A', instruction: 'i', outcomes: ['ok'], next: { ok: 'ghost' } },
        { id: 'b', title: 'B', instruction: 'i', outcomes: ['done'] },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('指向不存在的节点'))).toBe(true);
  });

  it('rejects a graph with no terminal outcome', () => {
    const r = parseSopDefinition({
      name: 'x',
      start: 'a',
      nodes: [
        { id: 'a', title: 'A', instruction: 'i', outcomes: ['ok'], next: { ok: 'b' } },
        { id: 'b', title: 'B', instruction: 'i', outcomes: ['ok'], next: { ok: 'a' } },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.errors.some((e) => e.includes('图中不存在终态'))).toBe(true);
  });
});

describe('advanceSop', () => {
  it('advances legally with an immutable update', () => {
    const run = makeRun();
    const r = advanceSop(run, 'a', 'ok', '做完了A');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.finished).toBe(false);
    expect(r.run.currentNodeId).toBe('b');
    expect(r.run.completed).toHaveLength(1);
    expect(r.run.completed[0]).toMatchObject({ nodeId: 'a', outcome: 'ok', evidence: '做完了A' });
    // original run untouched
    expect(run.currentNodeId).toBe('a');
    expect(run.completed).toHaveLength(0);
  });

  it('rejects a node mismatch without changing the run', () => {
    const run = makeRun();
    const r = advanceSop(run, 'b', 'done', 'x');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.error).toContain('节点不匹配');
    expect(run.currentNodeId).toBe('a');
    expect(run.completed).toHaveLength(0);
  });

  it('rejects an outcome not in the node enum', () => {
    const r = advanceSop(makeRun(), 'a', 'nope', 'x');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.error).toContain('不在节点');
  });

  it('completes the run on a terminal outcome', () => {
    const run = makeRun({ currentNodeId: 'b' });
    const r = advanceSop(run, 'b', 'done', '收尾完成');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.finished).toBe(true);
    expect(r.run.status).toBe('completed');
    expect(r.run.completed).toHaveLength(1);
  });

  it('rejects advancing a completed run', () => {
    const r = advanceSop(makeRun({ status: 'completed' }), 'a', 'ok', 'x');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.error).toContain('已完成');
  });

  it('rejects advancing an aborted run', () => {
    const r = advanceSop(makeRun({ status: 'aborted' }), 'a', 'ok', 'x');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.error).toContain('已中止');
  });
});

describe('formatSopForPrompt', () => {
  beforeEach(() => {
    useSopStore.setState({ runs: {} });
  });

  it('returns empty string when no active run', () => {
    expect(formatSopForPrompt('conv-x')).toBe('');
  });

  it('renders the current node and hard constraints for an active run', () => {
    useSopStore.getState().setRun('conv1', makeRun());
    const out = formatSopForPrompt('conv1');
    expect(out).toContain('a');
    expect(out).toContain('节点A');
    expect(out).toContain('做A');
    expect(out).toContain('ok');
    expect(out).toContain('硬性约束');
  });
});

describe('maybeActivateSopForSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSopStore.setState({ runs: {} });
  });

  it('does not activate when sop.json is absent', async () => {
    vi.mocked(exists).mockResolvedValue(false);
    await maybeActivateSopForSkill('conv1', 'core-workflow', '/skill/dir');
    expect(getActiveSopRun('conv1')).toBeUndefined();
  });

  it('does not activate and does not throw on invalid JSON', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue('{ not json');
    await expect(
      maybeActivateSopForSkill('conv1', 'core-workflow', '/skill/dir'),
    ).resolves.toBeUndefined();
    expect(getActiveSopRun('conv1')).toBeUndefined();
  });

  it('activates a run at the start node for a valid sop.json', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(validDef));
    await maybeActivateSopForSkill('conv1', 'core-workflow', '/skill/dir');
    const run = getActiveSopRun('conv1');
    expect(run).toBeDefined();
    expect(run?.currentNodeId).toBe(validDef.start);
    expect(run?.status).toBe('active');
  });

  it('is idempotent — keeps the in-flight run when one is already active', async () => {
    useSopStore.getState().setRun('conv1', makeRun({ currentNodeId: 'b' }));
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(validDef));
    await maybeActivateSopForSkill('conv1', 'core-workflow', '/skill/dir');
    expect(getActiveSopRun('conv1')?.currentNodeId).toBe('b');
  });
});
