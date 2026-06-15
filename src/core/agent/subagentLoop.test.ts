import { describe, it, expect } from 'vitest';
import { isNoProgressTurn, buildBoundAgentSystemPrompt } from './subagentLoop';

describe('buildBoundAgentSystemPrompt (免@==@ shared builder)', () => {
  it('uses the agent systemPrompt as the sole identity, with no 扶摇 soul leak', async () => {
    // Regression for the 免@ persona bug: a bound digital-employee prompt must be
    // built from the employee's OWN systemPrompt only — no 扶摇 capability/soul.
    const agent = { name: '数据分析师', systemPrompt: '你是资深数据分析师_PERSONA_MARKER', memory: 'session' } as never;
    const prompt = await buildBoundAgentSystemPrompt(agent, { workspacePath: null });
    expect(prompt).toContain('你是资深数据分析师_PERSONA_MARKER');
    expect(prompt).toContain('## 当前时间');
    expect(prompt).toContain('## 安全规则');
    // The default 扶摇 personality (soul) must NOT leak into a bound employee.
    expect(prompt).not.toContain('## 你的性格');
  });

  it('includes the workspace section when a workspace path is provided', async () => {
    const agent = { name: 'x', systemPrompt: 'P', memory: 'session' } as never;
    const prompt = await buildBoundAgentSystemPrompt(agent, { workspacePath: 'D:/proj' });
    expect(prompt).toContain('## 当前工作区');
    expect(prompt).toContain('D:/proj');
  });
});

describe('isNoProgressTurn', () => {
  it('flags a turn where every tool call is unparseable', () => {
    expect(isNoProgressTurn({
      toolCalls: [
        { input: { _parse_error: 'Failed to parse tool input: {"path":"' } },
        { input: { _parse_error: 'Failed to parse tool input: {"cmd":"' } },
      ],
      turnText: '',
      stopReason: 'tool_use',
    })).toBe(true);
  });

  it('does NOT flag when at least one tool call parsed (partial progress)', () => {
    // One good tool call means the turn can make progress — tolerate it.
    expect(isNoProgressTurn({
      toolCalls: [
        { input: { _parse_error: 'bad' } },
        { input: { path: '/tmp/ok.txt' } },
      ],
      turnText: '',
      stopReason: 'tool_use',
    })).toBe(false);
  });

  it('flags a max_tokens truncation that produced no text and no tool calls', () => {
    expect(isNoProgressTurn({
      toolCalls: [],
      turnText: '   ',
      stopReason: 'max_tokens',
    })).toBe(true);
  });

  it('does NOT flag max_tokens truncation that still produced some text', () => {
    // Partial text is usable output — append and stop, not a no-progress turn.
    expect(isNoProgressTurn({
      toolCalls: [],
      turnText: 'partial answer that got cut off',
      stopReason: 'max_tokens',
    })).toBe(false);
  });

  it('does NOT flag a normal end_turn with text', () => {
    expect(isNoProgressTurn({
      toolCalls: [],
      turnText: 'here is the answer',
      stopReason: 'end_turn',
    })).toBe(false);
  });

  it('does NOT flag a normal tool_use turn with valid args', () => {
    expect(isNoProgressTurn({
      toolCalls: [{ input: { path: '/tmp/a.txt' } }],
      turnText: '',
      stopReason: 'tool_use',
    })).toBe(false);
  });

  it('does NOT flag an empty turn that was not truncated (no tool calls, end_turn)', () => {
    // Only max_tokens truncation counts as no-progress for the empty case.
    expect(isNoProgressTurn({
      toolCalls: [],
      turnText: '',
      stopReason: 'end_turn',
    })).toBe(false);
  });
});
