import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerBackgroundAgent,
  completeBackgroundAgent,
  failBackgroundAgent,
  removeBackgroundAgent,
  getBackgroundAgents,
  getAgentsByConversation,
  getRunningAgents,
  canSpawnAgent,
  removeAgentsByConversation,
  setConversationLookup,
} from './backgroundAgentRegistry';

// Mock userInputQueue to capture injected messages
vi.mock('./userInputQueue', () => ({
  enqueueUserInput: vi.fn(),
}));

import { enqueueUserInput } from './userInputQueue';

// Provide conversation lookup for existence checks
const mockConversations: Record<string, unknown> = {
  'conv-1': { id: 'conv-1' },
  'conv-2': { id: 'conv-2' },
};
setConversationLookup(() => mockConversations);

function makeAgent(taskId: string, overrides?: Record<string, unknown>) {
  return {
    taskId,
    agentName: 'test-agent',
    task: 'test task',
    status: 'running' as const,
    startTime: Date.now(),
    conversationId: 'conv-1',
    subagentId: `sub-${taskId}`,
    ...overrides,
  };
}

describe('backgroundAgentRegistry', () => {
  beforeEach(() => {
    // Clean up all agents
    for (const a of getBackgroundAgents()) {
      removeBackgroundAgent(a.taskId);
    }
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('registers and retrieves agents', () => {
    registerBackgroundAgent(makeAgent('t1'));
    expect(getBackgroundAgents()).toHaveLength(1);
    expect(getBackgroundAgents()[0].taskId).toBe('t1');
  });

  it('rejects registration with empty conversationId', () => {
    registerBackgroundAgent(makeAgent('t1', { conversationId: '' }));
    expect(getBackgroundAgents()).toHaveLength(0);
  });

  it('completes agent and injects result', () => {
    registerBackgroundAgent(makeAgent('t1'));
    completeBackgroundAgent('t1', 'done!');

    const agents = getBackgroundAgents();
    expect(agents[0].status).toBe('completed');
    expect(agents[0].result).toBe('done!');
    expect(enqueueUserInput).toHaveBeenCalledWith(
      'conv-1',
      expect.stringContaining('<agent-result'),
      true,
    );
  });

  it('discards result when conversation no longer exists', () => {
    registerBackgroundAgent(makeAgent('t1', { conversationId: 'deleted-conv' }));
    completeBackgroundAgent('t1', 'done!');

    expect(enqueueUserInput).not.toHaveBeenCalled();
    expect(getBackgroundAgents()[0].status).toBe('completed');
  });

  it('discards error when conversation no longer exists', () => {
    registerBackgroundAgent(makeAgent('t1', { conversationId: 'deleted-conv' }));
    failBackgroundAgent('t1', 'oops');

    expect(enqueueUserInput).not.toHaveBeenCalled();
  });

  it('fails agent and injects error', () => {
    registerBackgroundAgent(makeAgent('t1'));
    failBackgroundAgent('t1', 'oops');

    const agents = getBackgroundAgents();
    expect(agents[0].status).toBe('error');
    expect(agents[0].error).toBe('oops');
    expect(enqueueUserInput).toHaveBeenCalled();
  });

  it('removes agent and cancels cleanup timer', () => {
    vi.useFakeTimers();
    registerBackgroundAgent(makeAgent('t1'));
    completeBackgroundAgent('t1', 'done');
    // Manually remove before 30s timer fires
    removeBackgroundAgent('t1');
    expect(getBackgroundAgents()).toHaveLength(0);

    // Advance past the 30s — should not error or re-notify
    vi.advanceTimersByTime(35_000);
    expect(getBackgroundAgents()).toHaveLength(0);
  });

  it('tracks running agents', () => {
    registerBackgroundAgent(makeAgent('t1'));
    registerBackgroundAgent(makeAgent('t2'));
    completeBackgroundAgent('t1', 'done');

    expect(getRunningAgents()).toHaveLength(1);
    expect(getRunningAgents()[0].taskId).toBe('t2');
  });

  describe('conversation scoping', () => {
    it('filters agents by conversation', () => {
      registerBackgroundAgent(makeAgent('t1', { conversationId: 'conv-1' }));
      registerBackgroundAgent(makeAgent('t2', { conversationId: 'conv-2' }));
      registerBackgroundAgent(makeAgent('t3', { conversationId: 'conv-1' }));

      expect(getAgentsByConversation('conv-1')).toHaveLength(2);
      expect(getAgentsByConversation('conv-2')).toHaveLength(1);
      expect(getAgentsByConversation('conv-3')).toHaveLength(0);
    });

    it('removes all agents for a conversation and returns running subagentIds', () => {
      registerBackgroundAgent(makeAgent('t1', { conversationId: 'conv-1', subagentId: 'sub-1' }));
      registerBackgroundAgent(makeAgent('t2', { conversationId: 'conv-1', subagentId: 'sub-2' }));
      registerBackgroundAgent(makeAgent('t3', { conversationId: 'conv-2', subagentId: 'sub-3' }));

      const runningIds = removeAgentsByConversation('conv-1');

      expect(runningIds).toEqual(['sub-1', 'sub-2']);
      expect(getBackgroundAgents()).toHaveLength(1);
      expect(getBackgroundAgents()[0].taskId).toBe('t3');
    });

    it('does not return completed agents subagentIds on removal', () => {
      registerBackgroundAgent(makeAgent('t1', { conversationId: 'conv-1' }));
      completeBackgroundAgent('t1', 'done');

      const runningIds = removeAgentsByConversation('conv-1');
      expect(runningIds).toHaveLength(0);
    });
  });

  describe('per-conversation concurrency', () => {
    it('enforces limit per conversation', () => {
      for (let i = 0; i < 5; i++) {
        registerBackgroundAgent(makeAgent(`t${i}`, { conversationId: 'conv-1' }));
      }
      expect(canSpawnAgent('conv-1')).toBe(false);
      // Other conversation still has capacity
      expect(canSpawnAgent('conv-2')).toBe(true);
    });

    it('frees slot after completion', () => {
      for (let i = 0; i < 5; i++) {
        registerBackgroundAgent(makeAgent(`t${i}`, { conversationId: 'conv-1' }));
      }
      completeBackgroundAgent('t0', 'done');
      expect(canSpawnAgent('conv-1')).toBe(true);
    });
  });

  describe('auto-cleanup timer', () => {
    it('cleans up completed agents after 30s', () => {
      vi.useFakeTimers();
      registerBackgroundAgent(makeAgent('t1'));
      completeBackgroundAgent('t1', 'done');
      expect(getBackgroundAgents()).toHaveLength(1);

      vi.advanceTimersByTime(30_000);
      expect(getBackgroundAgents()).toHaveLength(0);
    });

    it('does not clean up running agents', () => {
      vi.useFakeTimers();
      registerBackgroundAgent(makeAgent('t1'));
      // Agent is still running — no completeBackgroundAgent call
      vi.advanceTimersByTime(35_000);
      expect(getBackgroundAgents()).toHaveLength(1);
    });
  });
});
