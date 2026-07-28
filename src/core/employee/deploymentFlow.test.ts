import { describe, expect, it } from 'vitest';
import {
  chooseDefaultInitPrompt,
  findExistingEmployeeConversation,
  hasBlockingEmployeeDependencies,
  unmetEmployeeDependencies,
  summarizeEmployeeDependencies,
} from './deploymentFlow';

describe('generic employee deployment flow', () => {
  it('finds the newest conversation for the same employee and workspace', () => {
    const found = findExistingEmployeeConversation({
      older: {
        id: 'older',
        title: 'Older',
        createdAt: 10,
        updatedAt: 10,
        messageCount: 1,
        agentName: 'generic-agent',
        workspacePath: 'C:/work/acme',
      },
      otherWorkspace: {
        id: 'otherWorkspace',
        title: 'Other',
        createdAt: 30,
        updatedAt: 30,
        messageCount: 1,
        agentName: 'generic-agent',
        workspacePath: 'C:/work/other',
      },
      newest: {
        id: 'newest',
        title: 'Newest',
        createdAt: 20,
        updatedAt: 40,
        messageCount: 2,
        agentName: 'generic-agent',
        workspacePath: 'C:/work/acme',
      },
    }, 'generic-agent', 'C:/work/acme');

    expect(found).toBe('newest');
  });

  it('chooses a localized prompt with a deterministic fallback', () => {
    expect(chooseDefaultInitPrompt({ zh: '你好', en: 'Hello' }, 'zh')).toBe('你好');
    expect(chooseDefaultInitPrompt({ en: 'Hello' }, 'zh')).toBe('Hello');
    expect(chooseDefaultInitPrompt(undefined, 'en')).toBeUndefined();
  });

  it('derives dependency health from generic contract fields', () => {
    const result = summarizeEmployeeDependencies(
      [
        { name: 'Workspace', type: 'workspace', required: true },
        {
          name: 'Python',
          type: 'command',
          required: true,
          runtimeId: 'python',
        },
        { name: 'Optional account', type: 'account', required: false },
      ],
      'C:/work/acme',
      { python: true },
    );

    expect(result).toEqual([
      expect.objectContaining({ name: 'Workspace', state: 'ready' }),
      expect.objectContaining({ name: 'Python', state: 'ready' }),
      expect.objectContaining({ name: 'Optional account', state: 'available-to-configure' }),
    ]);
    expect(hasBlockingEmployeeDependencies(result)).toBe(false);
    expect(hasBlockingEmployeeDependencies([
      { name: 'Python', required: true, state: 'unavailable' },
    ])).toBe(true);
  });

  // launch-video-director 就栽在这：包声明 { name:'node', type:'command', required:true }
  // 且没有 runtimeId，旧代码走兜底恒为 available-to-configure，而阻塞判据是
  // state !== 'ready' → 按钮永远灰着，且**从没探测过机器上有没有 node**。
  it('探测到命令即 ready，探测不到才算 unavailable', () => {
    const deps = [{ name: 'node', type: 'command' as const, required: true }];

    const installed = summarizeEmployeeDependencies(deps, null, { python: false, commands: { node: true } });
    expect(installed[0].state).toBe('ready');
    expect(hasBlockingEmployeeDependencies(installed)).toBe(false);

    const missing = summarizeEmployeeDependencies(deps, null, { python: false, commands: { node: false } });
    expect(missing[0].state).toBe('unavailable');
    expect(hasBlockingEmployeeDependencies(missing)).toBe(true);
    expect(unmetEmployeeDependencies(missing).map((d) => d.name)).toEqual(['node']);

    // 没跑探测（commands 缺这一项）时退回"可稍后配置"，不假装已就绪、也不硬拦。
    const unprobed = summarizeEmployeeDependencies(deps, null, { python: false });
    expect(unprobed[0].state).toBe('available-to-configure');
    expect(hasBlockingEmployeeDependencies(unprobed)).toBe(false);
  });

  it('必需的账号授权不再挡部署，但会列进"还差什么"', () => {
    // 授权只能等到真开工、在对话里发生，部署时无从完成 —— 拿它挡部署，
    // 等于这类员工永远部署不了。改为不拦但明确告知。
    const health = summarizeEmployeeDependencies(
      [{ name: 'ElevenLabs', type: 'account', required: true }],
      null,
      { python: false },
    );
    expect(health[0].state).toBe('needs-authorization');
    expect(hasBlockingEmployeeDependencies(health)).toBe(false);
    expect(unmetEmployeeDependencies(health).map((d) => d.name)).toEqual(['ElevenLabs']);
  });
});
