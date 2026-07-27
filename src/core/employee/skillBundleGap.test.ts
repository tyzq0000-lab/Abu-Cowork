import { describe, it, expect } from 'vitest';
import { validatePackageContract } from './contract';

// 「SKILL.md 让员工去用、包里却没有」的缺件检查（MISSING_SKILL_BUNDLE）。
// 与平台侧 server/src/__tests__/skillBundleGap.test.ts 同源，两侧判定必须一致。
const PLUGIN = JSON.stringify({
  name: 'demo-employee',
  agentName: 'demo-employee',
  version: '1.0.0',
  agents: ['./agents/demo-employee.md'],
  skills: ['./skills/cad'],
  runtime: { version: 1 },
});

const BASE_FILES = [
  '.codebuddy-plugin/plugin.json',
  'agents/demo-employee.md',
  'skills/cad/SKILL.md',
];

function gate(files: string[], skillText: string) {
  return validatePackageContract({
    pluginJson: PLUGIN,
    files,
    skillDocs: [{ path: 'skills/cad/SKILL.md', text: skillText }],
  });
}

const missing = (r: ReturnType<typeof gate>) =>
  r.audit.gaps.filter((g) => g.code === 'MISSING_SKILL_BUNDLE');

describe('MISSING_SKILL_BUNDLE：SKILL.md 引用了包内没有的捆绑文件', () => {
  it('壳包（只有 SKILL.md，引用的 scripts/references 都没打包）被标出缺件', () => {
    const gaps = missing(gate(BASE_FILES, '用 `python scripts/step` 生成，细节见 references/dxf.md'));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain('references/dxf.md');
  });

  it('缺件只警告、不拒安装', () => {
    const r = gate(BASE_FILES, '跑 `python scripts/step`');
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('MISSING_SKILL_BUNDLE');
  });

  it('文件真在包里就不报', () => {
    expect(missing(gate([...BASE_FILES, 'skills/cad/scripts/step'], '用 `python scripts/step`'))).toHaveLength(0);
  });

  it('只认三个约定目录，产出路径与外链不算缺件', () => {
    expect(missing(gate(BASE_FILES, '写到 output/report.md，见 https://example.com/scripts/foo.md'))).toHaveLength(0);
  });

  it('不传 skillDocs 时整段跳过', () => {
    const r = validatePackageContract({ pluginJson: PLUGIN, files: BASE_FILES });
    expect(r.audit.gaps.filter((g) => g.code === 'MISSING_SKILL_BUNDLE')).toHaveLength(0);
  });
});
