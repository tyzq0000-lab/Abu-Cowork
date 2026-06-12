import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { auditEmployeeArchiveEntries } from './archiveAudit';
import { renderEmployeeAuditMarkdown } from './report';

describe('employee archive audit', () => {
  it('finds a nested package root and reports missing referenced files', () => {
    const result = auditEmployeeArchiveEntries({
      'new-media-ops/.codebuddy-plugin/plugin.json': strToU8(JSON.stringify({
        name: 'new-media-ops',
        agentName: 'new-media-ops',
        agents: ['./agents/new-media-ops.md'],
        skills: ['./skills/content-diagnosis'],
        avatar: 'avatars/expert.png',
      })),
      'new-media-ops/agents/new-media-ops.md': strToU8('agent'),
      'new-media-ops/skills/content-diagnosis/SKILL.md': strToU8('skill'),
    });

    expect(result.name).toBe('new-media-ops');
    expect(result.report.level).toBe('L1');
    expect(result.report.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_AVATAR_FILE', blocking: false }),
      ]),
    );
  });

  it('renders maturity, gap ownership and capability ledger in Markdown', () => {
    const result = auditEmployeeArchiveEntries({
      '.codebuddy-plugin/plugin.json': strToU8(JSON.stringify({
        name: 'writer',
        agentName: 'writer',
        agents: ['./agents/writer.md'],
        skills: ['./skills/write'],
      })),
      'agents/writer.md': strToU8('agent'),
      'skills/write/SKILL.md': strToU8('skill'),
    });

    const markdown = renderEmployeeAuditMarkdown(result);

    expect(markdown).toContain('# 数字员工包审计：writer');
    expect(markdown).toContain('成熟度：**L1**');
    expect(markdown).toContain('员工包缺失');
    expect(markdown).toContain('MISSING_RUNTIME_CONTRACT');
    expect(markdown).toContain('开源能力账本');
  });

  it('rejects archives without a plugin manifest as L0 instead of throwing', () => {
    const result = auditEmployeeArchiveEntries({
      'README.md': strToU8('not an employee package'),
    });

    expect(result.name).toBe('unknown-package');
    expect(result.report.level).toBe('L0');
    expect(result.report.gaps[0]?.code).toBe('INVALID_MANIFEST');
  });
});
