import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ scanEmployees: vi.fn() }));
vi.mock('./employeeLoader', () => ({ scanEmployees: mocks.scanEmployees }));

const { AgentRegistry } = await import('./registry');

const EMPLOYEE = {
  name: 'launch-video-director',
  description: '发布视频导演',
  systemPrompt: 'fixture',
  source: 'employee' as const,
  filePath: '/Users/testuser/.uprow/employees/lvd/.codebuddy-plugin/plugin.json',
};

describe('AgentRegistry.discoverAgents：刷新期间对外始终是一份完整快照', () => {
  beforeEach(() => {
    mocks.scanEmployees.mockReset();
  });

  it('第二次扫描还在飞行中时，getAgent(员工名) 仍能解析到上一份快照', async () => {
    const registry = new AgentRegistry();
    mocks.scanEmployees.mockResolvedValue([EMPLOYEE]);
    await registry.discoverAgents();
    expect(registry.getAgent(EMPLOYEE.name)).toBeDefined();

    // 不 await —— 复刻真机时序：用户点击员工 → chatStore 写 workspaceStore →
    // discoveryStore 的订阅同步调用 refresh() → discoverAgents() 的同步前缀立刻执行。
    // 旧实现在这里 this.agents.clear()，于是 React 这一帧渲染读到 undefined，
    // ChatView 回落成默认扶摇欢迎页，而标题栏走 discoveryStore.agents 仍是对的。
    let release: () => void = () => {};
    mocks.scanEmployees.mockReturnValue(new Promise((resolve) => {
      release = () => resolve([EMPLOYEE]);
    }));
    const inFlight = registry.discoverAgents();

    expect(registry.getAgent(EMPLOYEE.name)).toBeDefined();
    expect(registry.getAgent('abu')).toBeDefined();

    release();
    await inFlight;
    expect(registry.getAgent(EMPLOYEE.name)).toBeDefined();
  });

  it('扫描结果整体换上：上一轮有、这一轮没有的员工会被移除', async () => {
    const registry = new AgentRegistry();
    mocks.scanEmployees.mockResolvedValue([EMPLOYEE]);
    await registry.discoverAgents();
    expect(registry.getAgent(EMPLOYEE.name)).toBeDefined();

    mocks.scanEmployees.mockResolvedValue([]);
    await registry.discoverAgents();
    expect(registry.getAgent(EMPLOYEE.name)).toBeUndefined();
    expect(registry.getAgent('abu')).toBeDefined();
  });
});
