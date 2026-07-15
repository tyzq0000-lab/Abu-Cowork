import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { buildChaWorkSubagent, loadChaWorkEmployee } from './employeeLoader';

const YAML = `id: weekly-report-helper
name: 周报整理助手
description: 把数据整理成周汇总。
kind: ordinary
status: active
`;
const PROMPT = '# 周报整理助手\n\n只依据原始数据，不编造。\n';

describe('buildChaWorkSubagent (dual-manifest ChaWork format)', () => {
  beforeEach(() => {
    vi.mocked(readDir).mockReset();
    vi.mocked(readTextFile).mockReset();
  });

  it('normalizes employee.yaml + prompt.md + skills onto the native runtime', () => {
    const def = buildChaWorkSubagent(YAML, PROMPT, ['weekly-summary']);
    expect(def).not.toBeNull();
    expect(def!.name).toBe('weekly-report-helper'); // canonical = id slug
    expect(def!.displayNames?.['zh-CN']).toBe('周报整理助手');
    expect(def!.description).toBe('把数据整理成周汇总。');
    expect(def!.engine).toBe('native');
    expect(def!.memory).toBe('project');
    expect(def!.memoryAutoCapture).toBeUndefined();
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

  it('rejects archived, reserved, and unsafe employee identities', () => {
    expect(buildChaWorkSubagent('id: archived\nstatus: archived\n', 'x', [])).toBeNull();
    expect(buildChaWorkSubagent('id: abu\nstatus: active\n', 'x', [])).toBeNull();
    expect(buildChaWorkSubagent('id: ../escape\nstatus: active\n', 'x', [])).toBeNull();
  });

  it('loads only enabled skills from the installed ChaWork registry', async () => {
    const pkg = '/Users/testuser/.uprow/employees/weekly-report-helper';
    const files: Record<string, string> = {
      [`${pkg}/employee.yaml`]: YAML,
      [`${pkg}/prompt.md`]: PROMPT,
      [`${pkg}/skills.json`]: JSON.stringify({
        version: 1,
        skills: [
          { id: 'weekly-summary', source: 'hub', enabled: true },
          { id: 'disabled-export', source: 'hub', enabled: false },
          { id: 'missing-on-disk', source: 'hub', enabled: true },
        ],
      }),
      [`${pkg}/dream.yaml`]: `enabled: true
schedule:
  type: daily
  time: "03:30"
session_scan:
  scope: all
  latest_sessions: 4`,
    };
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      const value = files[String(path)];
      if (value === undefined) throw new Error('ENOENT');
      return value;
    });
    vi.mocked(readDir).mockResolvedValue([
      { name: 'weekly-summary', isDirectory: true, isFile: false, isSymlink: false },
      { name: 'disabled-export', isDirectory: true, isFile: false, isSymlink: false },
    ]);

    const def = await loadChaWorkEmployee(pkg);

    expect(def?.skills).toEqual(['weekly-summary']);
    expect(def?.dream).toEqual({ enabled: true, schedule: 'daily', sessionScan: { maxSessions: 4 } });
    expect(def?.memoryAutoCapture).toEqual(['preference', 'feedback', 'failure', 'project', 'reference']);
    expect(def?.memoryWrites).toBe('approval');
  });
});
