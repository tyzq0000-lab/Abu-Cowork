import { describe, it, expect } from 'vitest';
import { validatePackageContract } from './contract';

// A minimal package that clears every blocking gate: identity + one skill +
// full runtime contract (persistent memory, recommended workflow, review,
// governed evolution, escalation, acceptance, resolved-license source ledger).
const CONFORMANT = {
  name: 'clean-worker',
  agentName: 'clean-worker',
  version: '1.0.0',
  agents: ['./agents/clean-worker.md'],
  skills: ['./skills/core'],
  runtime: {
    version: 1,
    memory: { scope: 'project', autoCapture: ['feedback'] },
    workflows: [{ id: 'w', name: 'W', prompt: 'do', recommended: true, kind: 'schedule', schedule: { frequency: 'weekly' } }],
    review: { metrics: [{ id: 'm', name: 'M', description: 'd', target: '>=90%' }] },
    evolution: { memoryWrites: 'auto', capabilityChanges: 'approval', workflowChanges: 'approval', triggerChanges: 'approval' },
    escalation: { conditions: ['x'], fallback: 'stop' },
    acceptance: [{ name: 'a', prompt: 'p', assertions: ['ok'] }],
    sources: [{ name: 'lib', origin: 'https://x', license: 'MIT', integration: 'wrapped', adoptedCapabilities: ['c'], excludedCapabilities: [], exclusionReasons: [], recoveryCost: 'low' }],
  },
};

const FILES = ['agents/clean-worker.md', 'skills/core/SKILL.md'];

const withRuntime = (patch: Record<string, unknown>) =>
  JSON.stringify({ ...CONFORMANT, runtime: { ...CONFORMANT.runtime, ...patch } });

describe('validatePackageContract (single mandatory contract gate)', () => {
  it('passes a fully conformant package', () => {
    const r = validatePackageContract({ pluginJson: JSON.stringify(CONFORMANT), files: FILES });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('blocks contract drift: unknown top-level runtime keys', () => {
    // The exact drift the four shipped packages carry, zero readers in src.
    const r = validatePackageContract({
      pluginJson: withRuntime({ capabilityPriority: ['a'], entrySkill: 'boss', budgets: { maxSteps: 42 } }),
      files: FILES,
    });
    expect(r.ok).toBe(false);
    const codes = r.errors.filter((e) => e.code === 'UNKNOWN_RUNTIME_KEY').map((e) => e.path);
    expect(codes).toEqual(['runtime.capabilityPriority', 'runtime.entrySkill', 'runtime.budgets']);
  });

  const UNDECIDED_LICENSE = withRuntime({
    sources: [{ name: 'up', origin: 'https://x', license: 'No license declared in audited upstream; use requires organization review', integration: 'wrapped', adoptedCapabilities: ['c'], excludedCapabilities: [], exclusionReasons: [], recoveryCost: 'low' }],
  });

  it('blocks an undecided license only when enforceLicense is on', () => {
    const r = validatePackageContract({ pluginJson: UNDECIDED_LICENSE, files: FILES, enforceLicense: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'UNRESOLVED_LICENSE' && e.path === 'runtime.sources.up')).toBe(true);
  });

  it('does NOT block an undecided license by default (founder deferred 2026-07-13)', () => {
    const r = validatePackageContract({ pluginJson: UNDECIDED_LICENSE, files: FILES });
    expect(r.errors.every((e) => e.code !== 'UNRESOLVED_LICENSE')).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('blocks an empty license string when enforceLicense is on', () => {
    const r = validatePackageContract({
      pluginJson: withRuntime({
        sources: [{ name: 'up', origin: 'https://x', license: '  ', integration: 'wrapped', adoptedCapabilities: ['c'], excludedCapabilities: [], exclusionReasons: [], recoveryCost: 'low' }],
      }),
      files: FILES,
      enforceLicense: true,
    });
    expect(r.errors.some((e) => e.code === 'UNRESOLVED_LICENSE')).toBe(true);
  });

  it('accepts a manual (user-triggered) workflow kind', () => {
    const r = validatePackageContract({
      pluginJson: withRuntime({
        workflows: [{ id: 'run', name: '手动处理', prompt: 'send me a file', recommended: true, kind: 'manual', permissions: ['file:read', 'file:write'] }],
      }),
      files: FILES,
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('blocks a missing runtime contract', () => {
    const { runtime, ...noRuntime } = CONFORMANT;
    void runtime;
    const r = validatePackageContract({ pluginJson: JSON.stringify(noRuntime), files: FILES });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'MISSING_RUNTIME_CONTRACT')).toBe(true);
  });

  it('blocks a package missing its declared skill file (blocking audit gap)', () => {
    const r = validatePackageContract({ pluginJson: JSON.stringify(CONFORMANT), files: ['agents/clean-worker.md'] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'MISSING_SKILL_FILE')).toBe(true);
  });

  it('rejects invalid JSON without throwing', () => {
    const r = validatePackageContract({ pluginJson: '{ not json', files: [] });
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('INVALID_JSON');
  });

  it('surfaces non-blocking maturity gaps as warnings, not errors', () => {
    // Drop review metrics → NO_REVIEW is non-blocking; package still lists.
    const { review, ...rt } = CONFORMANT.runtime;
    void review;
    const r = validatePackageContract({
      pluginJson: JSON.stringify({ ...CONFORMANT, runtime: rt }),
      files: FILES,
    });
    expect(r.warnings.some((w) => w.code === 'MISSING_REVIEW_METRICS')).toBe(true);
    expect(r.errors.every((e) => e.code !== 'MISSING_REVIEW_METRICS')).toBe(true);
  });
});
