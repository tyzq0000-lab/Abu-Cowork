import { describe, expect, it } from 'vitest';
import {
  auditEmployeePackage,
  parseEmployeePlugin,
  type EmployeePluginManifest,
} from './contract';

const BASE_FILES = [
  '.codebuddy-plugin/plugin.json',
  'agents/new-media-ops.md',
  'skills/content-diagnosis/SKILL.md',
];

function baseManifest(): EmployeePluginManifest {
  return {
    name: 'new-media-ops',
    agentName: 'new-media-ops',
    agents: ['./agents/new-media-ops.md'],
    skills: ['./skills/content-diagnosis'],
    displayName: { zh: '运小运', en: 'Nova' },
  };
}

describe('employee package contract', () => {
  it('parses a valid manifest and rejects non-object JSON', () => {
    expect(parseEmployeePlugin(JSON.stringify(baseManifest()))?.agentName).toBe('new-media-ops');
    expect(parseEmployeePlugin('[]')).toBeNull();
    expect(parseEmployeePlugin('{broken')).toBeNull();
  });

  it('drops a malformed runtime contract instead of crashing later audit', () => {
    const parsed = parseEmployeePlugin(JSON.stringify({
      ...baseManifest(),
      runtime: {
        version: 1,
        memory: { scope: 'forever' },
        workflows: 'not-an-array',
      },
    }));

    expect(parsed?.runtime).toBeUndefined();
    expect(() => auditEmployeePackage({
      manifest: parsed,
      files: BASE_FILES,
    })).not.toThrow();
  });

  it('rejects incomplete nested runtime records', () => {
    const parsed = parseEmployeePlugin(JSON.stringify({
      ...baseManifest(),
      runtime: {
        version: 1,
        memory: { scope: 'project' },
        workflows: [],
        review: { metrics: [{}] },
        evolution: {},
        escalation: {},
        acceptance: [{}],
        dependencies: [{}],
        sources: [{}],
      },
    }));

    expect(parsed?.runtime).toBeUndefined();
  });

  it('classifies identity plus skills without runtime contract as L1', () => {
    const report = auditEmployeePackage({
      manifest: baseManifest(),
      files: BASE_FILES,
    });

    expect(report.level).toBe('L1');
    expect(report.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: 'employee-package',
          code: 'MISSING_RUNTIME_CONTRACT',
        }),
      ]),
    );
  });

  it('classifies a complete autonomous package as L3', () => {
    const manifest: EmployeePluginManifest = {
      ...baseManifest(),
      runtime: {
        version: 1,
        targetMaturity: 'L3',
        memory: {
          scope: 'project',
          autoCapture: ['preference', 'feedback', 'failure', 'project'],
        },
        workflows: [
          {
            id: 'weekly-review',
            kind: 'schedule',
            name: '每周内容复盘',
            description: '每周复盘内容表现并生成下周选题建议',
            prompt: '读取本周内容数据，完成复盘并输出下周建议。',
            skillName: 'content-diagnosis',
            recommended: true,
            schedule: {
              frequency: 'weekly',
              dayOfWeek: 3,
              time: { hour: 9, minute: 0 },
            },
          },
        ],
        review: {
          cadence: 'weekly',
          metrics: [
            {
              id: 'prediction-accuracy',
              name: '选题预测准确率',
              description: '预测档位与真实表现的一致率',
            },
          ],
        },
        evolution: {
          memoryWrites: 'auto',
          capabilityChanges: 'approval',
          workflowChanges: 'approval',
          triggerChanges: 'approval',
        },
        escalation: {
          conditions: ['缺少发布账号', '涉及正式账号发布'],
          fallback: '停止执行并请求用户确认',
        },
        acceptance: [
          {
            name: '完成周度复盘',
            prompt: '对测试数据执行周度复盘',
            assertions: ['输出指标对比', '输出下周选题建议'],
          },
        ],
        dependencies: [
          {
            name: '内容数据目录',
            type: 'workspace',
            required: true,
            description: '用于读取历史内容表现和保存复盘产物',
          },
        ],
        sources: [
          {
            name: 'content-diagnosis',
            origin: 'https://example.com/content-diagnosis',
            license: 'MIT',
            integration: 'adapted',
            adoptedCapabilities: ['五维内容诊断'],
            excludedCapabilities: ['独立 Web UI'],
            exclusionReasons: ['扶摇直接调用核心诊断逻辑，不需要重复 UI'],
            recoveryCost: 'low',
          },
        ],
      },
    };

    const report = auditEmployeePackage({ manifest, files: BASE_FILES });

    expect(report.level).toBe('L3');
    expect(report.targetLevel).toBe('L3');
    expect(report.gaps.filter((gap) => gap.blocking)).toEqual([]);
    expect(report.capabilityLedger).toEqual([
      expect.objectContaining({
        source: 'content-diagnosis',
        adopted: ['五维内容诊断'],
        excluded: ['独立 Web UI'],
      }),
    ]);
  });

  it('separates runtime configuration and external service blockers', () => {
    const manifest: EmployeePluginManifest = {
      ...baseManifest(),
      runtime: {
        version: 1,
        targetMaturity: 'L2',
        memory: { scope: 'project', autoCapture: ['feedback'] },
        workflows: [],
        dependencies: [
          { name: 'XHS_COOKIE', type: 'environment', required: true },
          { name: '小红书账号', type: 'account', required: true },
        ],
      },
    };

    const report = auditEmployeePackage({ manifest, files: BASE_FILES });

    expect(report.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: 'runtime-config', code: 'DEPENDENCY_ENVIRONMENT' }),
        expect.objectContaining({ owner: 'external-service', code: 'DEPENDENCY_ACCOUNT' }),
      ]),
    );
  });
});

describe('cron trigger template validation', () => {
  function manifestWithCron(source: Record<string, unknown>): string {
    return JSON.stringify({
      ...baseManifest(),
      runtime: {
        version: 1,
        workflows: [
          {
            id: 'wf-cron',
            name: 'Heartbeat',
            prompt: 'tick',
            kind: 'trigger',
            source: { type: 'cron', ...source },
            filter: { type: 'always' },
          },
        ],
      },
    });
  }

  it('keeps runtime when the cron interval is a finite value >= 10s', () => {
    const parsed = parseEmployeePlugin(manifestWithCron({ intervalSeconds: 60 }));
    expect(parsed?.runtime?.workflows).toHaveLength(1);
  });

  // A missing intervalSeconds is the real-world NaN source: undefined * 1000 = NaN,
  // which slips past the engine's bare `< 10_000` guard. 0 and 9 are below the 10s floor.
  it.each([
    ['missing intervalSeconds (→ NaN at runtime)', {}],
    ['zero intervalSeconds', { intervalSeconds: 0 }],
    ['9s (below 10s minimum)', { intervalSeconds: 9 }],
  ])('strips runtime for an invalid cron template: %s', (_label, source) => {
    const parsed = parseEmployeePlugin(manifestWithCron(source));
    // Invalid runtime is stripped (parseEmployeePlugin deletes manifest.runtime).
    expect(parsed?.runtime).toBeUndefined();
  });
});
