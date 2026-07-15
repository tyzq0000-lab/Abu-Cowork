import { describe, expect, it } from 'vitest';
import {
  chooseDefaultInitPrompt,
  findExistingEmployeeConversation,
  hasBlockingEmployeeDependencies,
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
});
