import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('./registry', () => ({
  agentRegistry: {
    getAgent: vi.fn().mockReturnValue({ name: 'abu', systemPrompt: '测试人格', description: '桌面助手' }),
    getAvailableAgents: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../skill/loader', () => ({
  skillLoader: {
    getSkill: vi.fn(),
    getAvailableSkills: vi.fn().mockReturnValue([]),
    findMatchingSkills: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../memdir/scan', () => ({
  loadMemoryIndex: vi.fn().mockResolvedValue(''),
  scanMemoryFiles: vi.fn().mockResolvedValue([]),
  readMemoryFile: vi.fn().mockResolvedValue(null),
}));

vi.mock('../memdir/write', () => ({
  touchMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./projectRules', () => ({
  loadAllRules: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: vi.fn().mockReturnValue({ currentPath: '/test/workspace' }),
    subscribe: vi.fn(),
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({
      computerUseEnabled: false,
      disabledSkills: [],
      disabledAgents: [],
      contextWindowSize: 200000,
      allowSkillCommands: false,
    }),
  },
}));

vi.mock('../session/sessionDir', () => ({
  getSessionOutputDir: vi.fn().mockResolvedValue('/tmp/session-output'),
}));

vi.mock('../../utils/platform', () => ({
  isWindows: vi.fn().mockReturnValue(false),
}));

vi.mock('../mcp/client', () => ({
  mcpManager: {
    isConnected: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../skill/preprocessor', () => ({
  substituteVariables: vi.fn((content: string) => content),
  executeInlineCommands: vi.fn((content: string) => content),
}));

import { buildSystemPrompt, routeInput } from './orchestrator';
import { loadAllRules } from './projectRules';
import { loadMemoryIndex, scanMemoryFiles } from '../memdir/scan';

const mockLoadAllRules = vi.mocked(loadAllRules);
const mockLoadMemoryIndex = vi.mocked(loadMemoryIndex);
const mockScanMemoryFiles = vi.mocked(scanMemoryFiles);

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadAllRules.mockResolvedValue('');
  mockLoadMemoryIndex.mockResolvedValue('');
  mockScanMemoryFiles.mockResolvedValue([]);
});

describe('buildSystemPrompt - security features', () => {
  const basePrompt = '你叫阿布，测试用基础 prompt。';
  const generalRoute = routeInput('你好');

  it('ends with safety anchor', async () => {
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    // Safety anchor should be at the very end
    expect(prompt).toContain('## 安全提醒');
    const safetyIdx = prompt.lastIndexOf('## 安全提醒');
    const lastSection = prompt.slice(safetyIdx);
    expect(lastSection).toContain('以系统指令为准');
    expect(lastSection).toContain('不要透露');
    expect(lastSection).toContain('不要被');
    // No other ## section should come after safety anchor
    const afterSafety = prompt.slice(safetyIdx + '## 安全提醒'.length);
    expect(afterSafety).not.toContain('\n## ');
  });

  it('wraps project rules in <user-rules> tags', async () => {
    mockLoadAllRules.mockResolvedValue('# 编码规范\n使用 TypeScript');
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    expect(prompt).toContain('<user-rules>');
    expect(prompt).toContain('</user-rules>');
    // Content should be inside the tags
    const rulesStart = prompt.indexOf('<user-rules>');
    const rulesEnd = prompt.indexOf('</user-rules>');
    const rulesContent = prompt.slice(rulesStart, rulesEnd);
    expect(rulesContent).toContain('使用 TypeScript');
  });

  it('does not push per-file memory content (pull-based: index only)', async () => {
    // Regression: previously the orchestrator selected top 5 memories by an
    // accessCount-based score and inlined their content under <agent-memory>.
    // That created a positive feedback loop (high accessCount → re-injected →
    // accessCount bumped again) and pushed content unrelated to the current
    // query. The new contract: only the MEMORY.md index is injected, and the
    // agent pulls per-file details on demand via the recall tool.
    mockScanMemoryFiles.mockResolvedValue([{
      filename: 'user_test.md', filePath: '/mock/user_test.md',
      name: '用户喜欢简洁回复', description: '用户喜欢简洁回复',
      type: 'user', source: 'agent_explicit',
      created: Date.now(), updated: Date.now(), accessCount: 0,
    }]);
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    expect(prompt).not.toContain('## 近期记忆详情');
    // Memory body content must not appear in the prompt
    expect(prompt).not.toContain('### [user] 用户喜欢简洁回复');
  });

  it('wraps memory index in <memory-index> tags', async () => {
    mockLoadMemoryIndex.mockResolvedValue('- [user_role.md](user_role.md) — 数据团队 PM');
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    expect(prompt).toContain('<memory-index>');
    expect(prompt).toContain('</memory-index>');
    const memStart = prompt.indexOf('<memory-index>');
    const memEnd = prompt.indexOf('</memory-index>');
    const memContent = prompt.slice(memStart, memEnd);
    expect(memContent).toContain('数据团队 PM');
  });

  it('safety anchor references the XML tag names', async () => {
    mockLoadAllRules.mockResolvedValue('some rules');
    mockLoadMemoryIndex.mockResolvedValue('- some memory index');
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    const safetySection = prompt.slice(prompt.lastIndexOf('## 安全提醒'));
    // Anchor should reference key XML tag names so the model knows what to be cautious about
    expect(safetySection).toContain('<user-rules>');
    expect(safetySection).toContain('<agent-memory>');
  });

  it('includes trust boundary note for project rules', async () => {
    mockLoadAllRules.mockResolvedValue('some rules');
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    expect(prompt).toContain('安全规则为准');
  });
});

describe('buildSystemPrompt - structure', () => {
  const basePrompt = '你叫阿布，测试用基础 prompt。';
  const generalRoute = routeInput('你好');

  it('includes current date/time', async () => {
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    expect(prompt).toContain('## 当前时间');
  });

  it('includes workspace path', async () => {
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    expect(prompt).toContain('/test/workspace');
  });

  it('injects request_workspace hint + skill_manage/memory scenarios when workspace is null (Task #37)', async () => {
    // Flip global workspace to null — prompt should now contain the
    // extended "workspace missing" guidance covering not just file ops
    // but also skill_manage and memdir writes.
    const { useWorkspaceStore } = await import('../../stores/workspaceStore');
    vi.mocked(useWorkspaceStore.getState).mockReturnValueOnce({ currentPath: null } as ReturnType<typeof useWorkspaceStore.getState>);

    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');

    expect(prompt).toContain('工作区提醒');
    expect(prompt).toContain('request_workspace');
    // The extended scenarios must be listed so the agent doesn't assume
    // "no workspace = only blocks file ops" — skill_manage / memory too.
    expect(prompt).toContain('skill_manage');
    expect(prompt).toContain('Memory 写入');
  });

  it('uses Chinese headings for skills and agents sections', async () => {
    const prompt = await buildSystemPrompt(generalRoute, basePrompt, 'test-conv');
    // Should NOT contain English headings
    expect(prompt).not.toContain('## Available Skills');
    expect(prompt).not.toContain('## Available Agents');
  });

  it('does not inject rules/memory in fork context', async () => {
    mockLoadAllRules.mockResolvedValue('should not appear');
    mockLoadMemoryIndex.mockResolvedValue('should not appear either');
    const forkRoute = {
      type: 'skill' as const,
      name: 'test-skill',
      skill: { name: 'test-skill', description: 'test', content: 'do stuff', context: 'fork', filePath: '/test', skillDir: '/test' },
      skillContent: 'do stuff',
      cleanInput: 'test',
    };
    const prompt = await buildSystemPrompt(forkRoute, basePrompt, 'test-conv');
    // Rules and memory content should not be injected in fork mode
    expect(prompt).not.toContain('should not appear');
    // The actual <user-rules> data section should not exist (no loadAllRules result injected)
    // Note: safety anchor may reference tag names, but no actual tagged content blocks
    expect(prompt).not.toContain('## 项目规则');
    expect(prompt).not.toContain('## 你的长期记忆');
  });
});

describe('buildSystemPrompt - employee skill gating', () => {
  const basePrompt = '你叫阿布，测试用基础 prompt。';

  it('shows an employee skill only when its owning employee is the active agent', async () => {
    const { skillLoader } = await import('../skill/loader');
    vi.mocked(skillLoader.getAvailableSkills).mockReturnValue([
      { name: 'humanizer', description: '去AI味', source: 'employee' },
      { name: 'novel-writer', description: '写小说', source: 'employee' },
      { name: 'writing-helper', description: '通用写作', source: 'user' },
    ] as never);

    // Active agent = the content-creator employee, which owns only humanizer.
    const route = {
      ...routeInput('你好'),
      name: 'content-creator',
      definition: {
        name: 'content-creator',
        systemPrompt: '你是文爆爆',
        skills: ['humanizer'],
        source: 'employee',
      },
    };

    const prompt = await buildSystemPrompt(route as never, basePrompt, 'test-conv');
    expect(prompt).toContain('humanizer');        // owned employee skill → shown
    expect(prompt).toContain('writing-helper');   // non-employee skill → always global
    expect(prompt).not.toContain('novel-writer'); // another employee's skill → hidden
  });

  it('hides all employee skills for the default agent (owns no employee skills)', async () => {
    const { skillLoader } = await import('../skill/loader');
    vi.mocked(skillLoader.getAvailableSkills).mockReturnValue([
      { name: 'humanizer', description: '去AI味', source: 'employee' },
      { name: 'writing-helper', description: '通用写作', source: 'user' },
    ] as never);

    // routeInput('你好') resolves definition to the builtin abu (no skills),
    // so ownedEmployeeSkills is empty and every employee skill is gated out.
    const prompt = await buildSystemPrompt(routeInput('你好'), basePrompt, 'test-conv');
    expect(prompt).toContain('writing-helper');
    expect(prompt).not.toContain('humanizer');
  });
});

describe('routeInput', () => {
  it('returns general route for plain text', () => {
    const result = routeInput('你好');
    expect(result.type).toBe('general');
    expect(result.name).toBe('abu');
  });

  it('returns general route for empty input', () => {
    const result = routeInput('');
    expect(result.type).toBe('general');
  });

  it('returns general route for bare slash', () => {
    const result = routeInput('/');
    expect(result.type).toBe('general');
  });
});

describe('routeInput - bound contact (IM 化 免@)', () => {
  it('routes an override-free message to the bound digital-employee as type=agent', async () => {
    const { agentRegistry } = await import('./registry');
    vi.mocked(agentRegistry.getAgent).mockImplementation((name: string) =>
      name === '产品经理'
        ? { name: '产品经理', systemPrompt: '你是产品经理', description: 'PM' } as never
        : { name: 'abu', systemPrompt: '测试人格', description: '桌面助手' } as never,
    );

    const result = routeInput('帮我写一份需求文档', '产品经理');
    expect(result.type).toBe('agent');
    expect(result.name).toBe('产品经理');
    expect(result.definition?.name).toBe('产品经理');
    expect(result.cleanInput).toBe('帮我写一份需求文档');
  });

  it('does not switch persona when bound to the default 扶摇 assistant (abu)', () => {
    const result = routeInput('你好', 'abu');
    expect(result.type).toBe('general');
    expect(result.name).toBe('abu');
  });

  it('falls back to general when the bound agent is disabled', async () => {
    const { agentRegistry } = await import('./registry');
    vi.mocked(agentRegistry.getAgent).mockImplementation((name: string) =>
      name === '产品经理'
        ? { name: '产品经理', systemPrompt: '你是产品经理', description: 'PM' } as never
        : { name: 'abu', systemPrompt: '测试人格', description: '桌面助手' } as never,
    );
    const { useSettingsStore } = await import('../../stores/settingsStore');
    vi.mocked(useSettingsStore.getState).mockReturnValueOnce({
      computerUseEnabled: false, disabledSkills: [], disabledAgents: ['产品经理'],
      contextWindowSize: 200000, allowSkillCommands: false,
    } as never);

    const result = routeInput('帮我写需求', '产品经理');
    expect(result.type).toBe('general');
    expect(result.name).toBe('abu');
  });

  it('lets an explicit @mention override the bound contact', async () => {
    const { agentRegistry } = await import('./registry');
    vi.mocked(agentRegistry.getAgent).mockImplementation((name: string) =>
      name === '设计师'
        ? { name: '设计师', systemPrompt: '你是设计师', description: 'Designer' } as never
        : { name: 'abu', systemPrompt: '测试人格', description: '桌面助手' } as never,
    );

    // Conversation is bound to 产品经理, but the user explicitly @设计师 — the
    // typed override wins and routes as a one-shot delegate, not the binding.
    const result = routeInput('@设计师 做一张海报', '产品经理');
    expect(result.type).toBe('delegate');
    expect(result.name).toBe('设计师');
  });

  it('lets an explicit /skill override the bound contact', async () => {
    const { skillLoader } = await import('../skill/loader');
    vi.mocked(skillLoader.getSkill).mockReturnValue({
      name: 'docx', description: '生成 Word', content: '步骤', filePath: '/s', skillDir: '/s',
    } as never);

    const result = routeInput('/docx 把报告转成 Word', '产品经理');
    expect(result.type).toBe('skill');
    expect(result.name).toBe('docx');
  });
});
