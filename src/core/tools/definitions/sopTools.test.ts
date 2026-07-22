import { describe, it, expect, beforeEach } from 'vitest';
import { sopAdvanceTool } from './sopTools';
import { useSopStore, type SopDefinition, type SopRunState } from '@/stores/sopStore';

const validDef: SopDefinition = {
  name: '测试流程',
  version: '1',
  start: 'a',
  nodes: [
    { id: 'a', title: '节点A', instruction: '做A', outcomes: ['ok'], next: { ok: 'b' } },
    { id: 'b', title: '节点B', instruction: '做B', outcomes: ['done'] },
  ],
};

const CONV = 'conv1';
const ctx = { conversationId: CONV };

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

function seedRun(run: SopRunState = makeRun()) {
  useSopStore.getState().setRun(CONV, run);
}

describe('sopAdvanceTool', () => {
  beforeEach(() => {
    useSopStore.setState({ runs: {} });
  });

  it('reports that no call is needed when there is no active SOP', async () => {
    const result = await sopAdvanceTool.execute(
      { node_id: 'a', outcome: 'ok', evidence: 'x' },
      ctx,
    );
    expect(result).toContain('无需调用');
  });

  it('rejects missing node_id / outcome without changing state', async () => {
    seedRun();
    const result = await sopAdvanceTool.execute({ evidence: 'x' }, ctx);
    expect(result).toContain('需要 node_id 与 outcome');
    expect(useSopStore.getState().runs[CONV].currentNodeId).toBe('a');
  });

  it('rejects missing evidence without changing state', async () => {
    seedRun();
    const result = await sopAdvanceTool.execute({ node_id: 'a', outcome: 'ok' }, ctx);
    expect(result).toContain('evidence');
    expect(useSopStore.getState().runs[CONV].currentNodeId).toBe('a');
  });

  it('advances the store and returns the next node on a legal step', async () => {
    seedRun();
    const result = await sopAdvanceTool.execute(
      { node_id: 'a', outcome: 'ok', evidence: '做完了A' },
      ctx,
    );
    expect(useSopStore.getState().runs[CONV].currentNodeId).toBe('b');
    expect(result).toContain('落账');
    expect(result).toContain('节点B');
  });

  it('returns completion text on a terminal step', async () => {
    seedRun(makeRun({ currentNodeId: 'b' }));
    const result = await sopAdvanceTool.execute(
      { node_id: 'b', outcome: 'done', evidence: '收尾' },
      ctx,
    );
    expect(result).toContain('全部节点完成');
    expect(useSopStore.getState().runs[CONV].status).toBe('completed');
  });

  it('aborts the run when abort=true', async () => {
    seedRun();
    const result = await sopAdvanceTool.execute(
      { abort: true, evidence: '文件缺失无法继续' },
      ctx,
    );
    expect(result).toContain('已中止');
    expect(useSopStore.getState().runs[CONV].status).toBe('aborted');
  });
});
