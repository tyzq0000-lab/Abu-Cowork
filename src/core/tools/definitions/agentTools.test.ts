import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { createSubagentController } from '../../agent/subagentAbort';
import { getCurrentLoopContext } from '../../agent/permissionBridge';
import { runSubagentLoop } from '../../agent/subagentLoop';
import { useChatStore } from '../../../stores/chatStore';
import { skillLoader } from '../../skill/loader';
import { delegateToAgentTool, saveAgentTool, useSkillTool } from './agentTools';

// Mock dependencies not covered by global setup
vi.mock('../../skill/loader', () => ({
  skillLoader: { getSkill: vi.fn(), loadSkill: vi.fn(), refreshSkill: vi.fn() },
}));
vi.mock('../../agent/registry', () => ({
  agentRegistry: { getAgent: vi.fn(), listAgents: vi.fn().mockReturnValue([]) },
}));
vi.mock('../../agent/permissionBridge', () => ({
  getCurrentLoopContext: vi.fn(),
  getLoopContext: vi.fn(),
  requestWorkspace: vi.fn(),
}));
vi.mock('../../agent/subagentLoop', () => ({
  runSubagentLoop: vi.fn(),
  extractParentConversationSummary: vi.fn().mockReturnValue(''),
}));
vi.mock('../../agent/subagentAbort', () => ({
  createSubagentController: vi.fn(),
}));
vi.mock('../../../stores/chatStore', () => ({
  useChatStore: { getState: vi.fn().mockReturnValue({ activeConversationId: 'test', getActiveConversation: vi.fn() }) },
}));
vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: { getState: vi.fn().mockReturnValue({ disabledSkills: [] }) },
}));
vi.mock('../../../stores/discoveryStore', () => ({
  useDiscoveryStore: { getState: vi.fn().mockReturnValue({ refresh: vi.fn() }) },
}));
vi.mock('../../../utils/pathUtils', () => ({
  joinPath: (...parts: string[]) => parts.join('/'),
  ensureParentDir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../utils/validation', () => ({
  ITEM_NAME_RE: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
}));
vi.mock('../helpers/toolHelpers', () => ({
  getSystemInfoData: vi.fn().mockResolvedValue({ home: '/Users/testuser' }),
}));

// save_skill was deprecated — skill creation/modification now goes through
// skill_manage (see skillManageTool.test.ts). save_agent tests continue below.
describe('save_agent multi-file support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('save_agent', () => {
    it('should save AGENT.md + supporting files', async () => {
      const result = await saveAgentTool.execute({
        name: 'my-agent',
        content: '---\nname: my-agent\n---\n# My Agent',
        files: [
          { path: 'scripts/helper.py', content: 'print("hello")' },
        ],
      });

      expect(writeTextFile).toHaveBeenCalledTimes(2);
      expect(writeTextFile).toHaveBeenCalledWith(
        '/Users/testuser/.uprow/agents/my-agent/AGENT.md',
        expect.any(String),
      );
      expect(writeTextFile).toHaveBeenCalledWith(
        '/Users/testuser/.uprow/agents/my-agent/scripts/helper.py',
        'print("hello")',
      );
      expect(result).toContain('附属文件');
      expect(result).toContain('scripts/helper.py');
    });
  });
});

describe('use_skill employee ownership', () => {
  it('resolves the active employee package instead of a same-name global skill', async () => {
    vi.mocked(useChatStore.getState).mockReturnValue({ activeConversationId: null } as never);
    vi.mocked(skillLoader.getSkill).mockReturnValue({
      name: 'shared-research',
      description: 'Employee-owned workflow',
      content: 'Use the employee workflow.',
      filePath: '/employees/nature/skills/shared-research/SKILL.md',
      skillDir: '/employees/nature/skills/shared-research',
      source: 'employee',
    });

    const result = await useSkillTool.execute(
      { skill_name: 'shared-research' },
      { employeeName: 'nature-researcher', inlineSkillContent: true },
    );

    expect(skillLoader.getSkill).toHaveBeenCalledWith('shared-research', 'nature-researcher');
    expect(result).toContain('Use the employee workflow.');
  });
});

describe('delegate_to_agent deployment identity propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useChatStore.getState).mockReturnValue({
      activeConversationId: 'conv-platform-parent',
      conversations: { 'conv-platform-parent': { messages: [] } },
      setAgentStatus: vi.fn(),
      removeActiveAgent: vi.fn(),
    } as never);
    vi.mocked(getCurrentLoopContext).mockReturnValue({
      conversationId: 'conv-platform-parent',
      loopId: 'loop-parent',
      signal: new AbortController().signal,
      toolCallToStepId: new Map(),
      eventRouter: { getCurrentStepId: vi.fn() },
    } as never);
    vi.mocked(createSubagentController).mockReturnValue({
      subagentId: 'sub-test',
      signal: new AbortController().signal,
      cleanup: vi.fn(),
    });
    vi.mocked(runSubagentLoop).mockResolvedValue({ text: 'done' } as never);
  });

  it('passes the parent conversation id into a delegated employee run', async () => {
    await delegateToAgentTool.execute({ type: 'research', task: 'audit this' });
    expect(runSubagentLoop).toHaveBeenCalledWith(expect.objectContaining({
      parentConversationId: 'conv-platform-parent',
    }));
  });
});
