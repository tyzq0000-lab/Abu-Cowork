import { beforeEach, describe, expect, it } from 'vitest';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useTriggerStore } from '@/stores/triggerStore';
import { installRuntimeTemplates } from './runtimeTemplates';
import type { EmployeeRuntimeProfile } from './contract';

const PROFILE: EmployeeRuntimeProfile = {
  version: 1,
  targetMaturity: 'L3',
  memory: { scope: 'project', autoCapture: ['feedback'] },
  workflows: [
    {
      id: 'weekly-review',
      kind: 'schedule',
      name: '每周复盘',
      description: '复盘并提出改进',
      prompt: '执行每周复盘',
      schedule: {
        frequency: 'weekly',
        dayOfWeek: 3,
        time: { hour: 9, minute: 0 },
      },
    },
    {
      id: 'inbox-watch',
      kind: 'trigger',
      name: '监听素材目录',
      description: '新素材进入时执行分析',
      prompt: '分析新素材：$EVENT_DATA',
      source: { type: 'file', path: 'D:/content/inbox', events: ['create'] },
      filter: { type: 'always' },
      capability: 'safe_tools',
    },
  ],
};

describe('employee runtime templates', () => {
  beforeEach(() => {
    useScheduleStore.setState({ tasks: {} });
    useTriggerStore.setState({ triggers: {} });
  });

  it('installs confirmed schedule and trigger templates with provenance', () => {
    const result = installRuntimeTemplates('new-media-ops', PROFILE);

    expect(result.created).toHaveLength(2);
    expect(Object.values(useScheduleStore.getState().tasks)).toEqual([
      expect.objectContaining({
        name: '每周复盘',
        agentName: 'new-media-ops',
        source: {
          kind: 'employee-template',
          employeeName: 'new-media-ops',
          templateId: 'weekly-review',
        },
      }),
    ]);
    expect(Object.values(useTriggerStore.getState().triggers)).toEqual([
      expect.objectContaining({
        name: '监听素材目录',
        action: expect.objectContaining({
          agentName: 'new-media-ops',
        }),
        sourceTemplate: {
          kind: 'employee-template',
          employeeName: 'new-media-ops',
          templateId: 'inbox-watch',
        },
      }),
    ]);
  });

  it('does not duplicate templates when confirmation is repeated', () => {
    installRuntimeTemplates('new-media-ops', PROFILE);
    const result = installRuntimeTemplates('new-media-ops', PROFILE);

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(['weekly-review', 'inbox-watch']);
    expect(Object.keys(useScheduleStore.getState().tasks)).toHaveLength(1);
    expect(Object.keys(useTriggerStore.getState().triggers)).toHaveLength(1);
  });

  it('upgrades existing employee trigger templates with the selected workspace without duplicating them', () => {
    installRuntimeTemplates('generic-agent', {
      ...PROFILE,
      workflows: [
        {
          id: 'relative-file-watch',
          kind: 'trigger',
          name: 'Watch relative path',
          prompt: 'Handle $EVENT_DATA',
          source: {
            type: 'file',
            path: '.fuyao/generic/imports',
            events: ['create'],
          },
          filter: { type: 'always' },
          capability: 'safe_tools',
        },
      ],
    });

    const result = installRuntimeTemplates('generic-agent', {
      ...PROFILE,
      workflows: [
        {
          id: 'relative-file-watch',
          kind: 'trigger',
          name: 'Watch relative path',
          prompt: 'Handle $EVENT_DATA',
          source: {
            type: 'file',
            path: '.fuyao/generic/imports',
            events: ['create'],
          },
          filter: { type: 'always' },
          capability: 'safe_tools',
        },
      ],
    }, { workspacePath: 'D:/workspace/acme' });

    expect(result).toEqual({ created: [], skipped: ['relative-file-watch'] });
    const triggers = Object.values(useTriggerStore.getState().triggers);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].source).toEqual(expect.objectContaining({
      type: 'file',
      path: 'D:/workspace/acme/.fuyao/generic/imports',
    }));
    expect(triggers[0].action.workspacePath).toBe('D:/workspace/acme');
  });

  it('resolves relative file trigger paths inside the selected workspace', () => {
    installRuntimeTemplates('generic-agent', {
      ...PROFILE,
      workflows: [
        {
          id: 'relative-file-watch',
          kind: 'trigger',
          name: 'Watch relative path',
          prompt: 'Handle $EVENT_DATA',
          source: {
            type: 'file',
            path: '.fuyao/generic/imports',
            events: ['create'],
          },
          filter: { type: 'always' },
          capability: 'safe_tools',
        },
      ],
    }, { workspacePath: 'D:/workspace/acme' });

    const trigger = Object.values(useTriggerStore.getState().triggers)[0];
    expect(trigger.source).toEqual(expect.objectContaining({
      type: 'file',
      path: 'D:/workspace/acme/.fuyao/generic/imports',
    }));
    expect(trigger.action.workspacePath).toBe('D:/workspace/acme');
  });

  it('rejects relative file trigger paths that escape the selected workspace', () => {
    expect(() => installRuntimeTemplates('generic-agent', {
      ...PROFILE,
      workflows: [
        {
          id: 'escaping-file-watch',
          kind: 'trigger',
          name: 'Watch escaping path',
          prompt: 'Handle $EVENT_DATA',
          source: {
            type: 'file',
            path: '../outside',
            events: ['create'],
          },
          filter: { type: 'always' },
        },
      ],
    }, { workspacePath: 'D:/workspace/acme' })).toThrow('escapes the selected workspace');
  });
});
