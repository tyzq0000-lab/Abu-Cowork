import { describe, it, expect, beforeEach, vi } from 'vitest';
import { backfillProjectIds } from './projectMigration';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';

// Mock the disk-flush path triggered by setConversationProject so these
// tests stay in-memory. The store mutation itself is what we assert
// against; persistence is covered elsewhere.
vi.mock('@/core/session/conversationStorage', () => ({
  updateIndexEntry: vi.fn().mockResolvedValue(undefined),
}));

describe('backfillProjectIds', () => {
  beforeEach(() => {
    // Reset both stores to a clean slate.
    useChatStore.setState({
      conversations: {},
      conversationIndex: {},
      activeConversationId: null,
    });
    useProjectStore.setState({ projects: {} });
  });

  it('auto-associates indexed conversations when workspace matches a project', () => {
    const projectId = useProjectStore.getState().createProject({
      name: 'DA',
      workspacePath: '/Users/test/da',
    });
    useChatStore.setState((state) => ({
      ...state,
      conversationIndex: {
        c1: {
          id: 'c1',
          title: 'orphan chat',
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          workspacePath: '/Users/test/da',
        },
      },
    }));

    const n = backfillProjectIds();
    expect(n).toBe(1);
    expect(useChatStore.getState().conversationIndex.c1.projectId).toBe(projectId);
  });

  it('leaves conversations untouched when no project matches', () => {
    useChatStore.setState((state) => ({
      ...state,
      conversationIndex: {
        c1: {
          id: 'c1',
          title: 'floater',
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          workspacePath: '/Users/test/somewhere-else',
        },
      },
    }));

    const n = backfillProjectIds();
    expect(n).toBe(0);
    expect(useChatStore.getState().conversationIndex.c1.projectId).toBeUndefined();
  });

  it('never overwrites an existing projectId (idempotent)', () => {
    useProjectStore.getState().createProject({
      name: 'DA',
      workspacePath: '/Users/test/da',
    });
    useChatStore.setState((state) => ({
      ...state,
      conversationIndex: {
        c1: {
          id: 'c1',
          title: 'already bound',
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          workspacePath: '/Users/test/da',
          projectId: 'prj-original',
        },
      },
    }));

    const n = backfillProjectIds();
    // Regression guard: even if the workspace matches a different project,
    // the existing projectId wins. Backfill is an additive fix, never a
    // rewriter — otherwise a user's manual reassignment or legacy migration
    // decision could be silently clobbered on the next boot.
    expect(n).toBe(0);
    expect(useChatStore.getState().conversationIndex.c1.projectId).toBe('prj-original');
  });

  it('skips scheduled and trigger conversations', () => {
    useProjectStore.getState().createProject({
      name: 'DA',
      workspacePath: '/Users/test/da',
    });
    useChatStore.setState((state) => ({
      ...state,
      conversationIndex: {
        sched: {
          id: 'sched',
          title: 'daily report',
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          workspacePath: '/Users/test/da',
          scheduledTaskId: 'task-1',
        },
        trig: {
          id: 'trig',
          title: 'webhook',
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          workspacePath: '/Users/test/da',
          triggerId: 'trig-1',
        },
      },
    }));

    const n = backfillProjectIds();
    // System-owned conversations (scheduled / trigger) don't belong to a
    // user-facing project — they're runbooks, not project chats.
    expect(n).toBe(0);
    expect(useChatStore.getState().conversationIndex.sched.projectId).toBeUndefined();
    expect(useChatStore.getState().conversationIndex.trig.projectId).toBeUndefined();
  });

  it('skips conversations with no workspacePath', () => {
    useChatStore.setState((state) => ({
      ...state,
      conversationIndex: {
        c1: {
          id: 'c1',
          title: 'no workspace',
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          workspacePath: null,
        },
      },
    }));

    const n = backfillProjectIds();
    expect(n).toBe(0);
  });

  it('running twice has no additional effect (idempotent)', () => {
    const projectId = useProjectStore.getState().createProject({
      name: 'DA',
      workspacePath: '/Users/test/da',
    });
    useChatStore.setState((state) => ({
      ...state,
      conversationIndex: {
        c1: {
          id: 'c1',
          title: 'orphan',
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          workspacePath: '/Users/test/da',
        },
      },
    }));

    expect(backfillProjectIds()).toBe(1);
    expect(backfillProjectIds()).toBe(0);
    expect(useChatStore.getState().conversationIndex.c1.projectId).toBe(projectId);
  });
});
