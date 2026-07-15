import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runEmployeeChecks } from './employees';

const mocks = vi.hoisted(() => ({
  getAvailableAgents: vi.fn(),
  getAgent: vi.fn(),
  getDeploymentState: vi.fn(),
  getSettingsState: vi.fn(),
  readTextFile: vi.fn(),
  checkDependencies: vi.fn(),
  assertIntegrity: vi.fn(),
  resolveRelay: vi.fn(),
  checkProvider: vi.fn(),
  probeWrite: vi.fn(),
}));

vi.mock('@/core/agent/registry', () => ({
  agentRegistry: {
    getAvailableAgents: mocks.getAvailableAgents,
    getAgent: mocks.getAgent,
  },
}));
vi.mock('@/stores/employeeDeploymentStore', () => ({
  useEmployeeDeploymentStore: { getState: mocks.getDeploymentState },
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: mocks.getSettingsState },
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: mocks.readTextFile }));
vi.mock('@/core/employee/deploymentFlow', () => ({
  checkEmployeeDependencies: mocks.checkDependencies,
}));
vi.mock('@/core/employee/packageIntegrity', () => ({
  assertEmployeePackageIntegrity: mocks.assertIntegrity,
}));
vi.mock('@/core/employee/platformRelay', () => ({
  resolvePlatformRelayExecution: mocks.resolveRelay,
}));
vi.mock('./aiServices', () => ({
  checkProviderHealthWithTimeout: mocks.checkProvider,
}));
vi.mock('./permissions', () => ({ probeWrite: mocks.probeWrite }));

const deployment = {
  packageId: 'content-operator',
  employeeId: 'emp_1',
  hireId: 'hire_1',
  deploymentId: 'dep_11111111111111111111111111111111',
  agentName: 'content-operator',
  workspacePath: 'C:/work/content',
  conversationId: 'conv_1',
  configuredAt: 1,
};

describe('employee doctor checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAvailableAgents.mockReturnValue([]);
    mocks.getAgent.mockReturnValue({
      name: 'content-operator',
      description: 'Content operator',
      source: 'employee',
      systemPrompt: 'work',
      filePath: 'C:/employees/content-operator/.codebuddy-plugin/plugin.json',
    });
    mocks.getDeploymentState.mockReturnValue({
      deployments: { deployment },
      integrity: { 'content-operator': { keyId: 'trusted', manifestSha256: 'abc' } },
    });
    mocks.getSettingsState.mockReturnValue({ providers: [] });
    mocks.readTextFile.mockResolvedValue(JSON.stringify({
      name: 'content-operator',
      runtime: {
        version: 1,
        workspace: { required: true, selection: 'user-selected' },
        dependencies: [
          { name: 'Python', type: 'command', required: true, runtimeId: 'python' },
        ],
      },
    }));
    mocks.assertIntegrity.mockResolvedValue(undefined);
    mocks.probeWrite.mockResolvedValue({ ok: true, durationMs: 2 });
    mocks.checkDependencies.mockResolvedValue([
      { name: 'Python', required: true, state: 'ready' },
    ]);
    mocks.resolveRelay.mockResolvedValue({
      modelId: 'maker-model',
      provider: { id: 'relay', apiKey: 'secret', baseUrl: 'https://uprow.example/api/relay' },
      deployment,
    });
    mocks.checkProvider.mockResolvedValue({ success: true, latencyMs: 12 });
  });

  it('reports no employee as not applicable instead of healthy', async () => {
    mocks.getDeploymentState.mockReturnValue({ deployments: {}, integrity: {} });

    const rows = await runEmployeeChecks();

    expect(rows).toEqual([expect.objectContaining({ id: 'employees:none', status: 'skipped' })]);
  });

  it('checks package, workspace, dependencies, and the real platform model channel', async () => {
    const rows = await runEmployeeChecks();

    expect(rows.map((row) => [row.id.split(':').at(-1), row.status])).toEqual([
      ['package', 'passed'],
      ['workspace', 'passed'],
      ['dependencies', 'passed'],
      ['model', 'passed'],
    ]);
    expect(mocks.assertIntegrity).toHaveBeenCalledTimes(1);
    expect(mocks.probeWrite).toHaveBeenCalledWith(expect.stringContaining('C:/work/content'));
    expect(mocks.checkProvider).toHaveBeenCalledTimes(1);
  });

  it('surfaces blocking dependencies and a broken deployment credential', async () => {
    mocks.checkDependencies.mockResolvedValue([
      { name: 'Python', required: true, state: 'unavailable' },
    ]);
    mocks.resolveRelay.mockRejectedValue(new Error('credential revoked'));

    const rows = await runEmployeeChecks();

    expect(rows.find((row) => row.id.endsWith(':dependencies'))).toMatchObject({
      status: 'failed',
      suggestedAction: { type: 'open-conversation', target: 'conv_1' },
    });
    expect(rows.find((row) => row.id.endsWith(':model'))).toMatchObject({
      status: 'failed',
      errorDetail: 'credential revoked',
    });
  });
});
