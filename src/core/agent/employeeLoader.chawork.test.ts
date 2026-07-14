import { describe, it, expect } from 'vitest';
import { buildChaWorkSubagent } from './employeeLoader';

const YAML = `id: weekly-report-helper
name: 周报整理助手
description: 把数据整理成周汇总。
kind: ordinary
status: active
`;
const PROMPT = '# 周报整理助手\n\n只依据原始数据，不编造。\n';

describe('buildChaWorkSubagent (dual-manifest ChaWork format)', () => {
  it('maps employee.yaml + prompt.md + skills into a codex-engine SubagentDefinition', () => {
    const def = buildChaWorkSubagent(YAML, PROMPT, ['weekly-summary']);
    expect(def).not.toBeNull();
    expect(def!.name).toBe('weekly-report-helper'); // canonical = id slug
    expect(def!.displayNames?.['zh-CN']).toBe('周报整理助手');
    expect(def!.description).toBe('把数据整理成周汇总。');
    expect(def!.engine).toBe('codex'); // ChaWork packages route to codex
    expect(def!.source).toBe('employee');
    expect(def!.skills).toEqual(['weekly-summary']);
    expect(def!.systemPrompt).toContain('只依据原始数据');
  });

  it('falls back to id when name is absent, and omits skills when none', () => {
    const def = buildChaWorkSubagent('id: solo\nstatus: active\n', '', []);
    expect(def!.name).toBe('solo');
    expect(def!.skills).toBeUndefined();
    expect(def!.systemPrompt).toBe('');
  });

  it('returns null when the manifest has no id or name', () => {
    expect(buildChaWorkSubagent('description: nameless\n', 'x', [])).toBeNull();
  });

  it('returns null on unparseable yaml', () => {
    expect(buildChaWorkSubagent('::: not : valid : yaml :::', 'x', [])).toBeNull();
  });
});
