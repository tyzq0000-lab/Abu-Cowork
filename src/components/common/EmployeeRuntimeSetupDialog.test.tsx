import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EmployeeRuntimeSetupDialog from './EmployeeRuntimeSetupDialog';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import { useScheduleStore } from '@/stores/scheduleStore';

describe('EmployeeRuntimeSetupDialog', () => {
  afterEach(cleanup);

  beforeEach(() => {
    useDeepLinkStore.setState({
      pending: null,
      installing: false,
      runtimeSetup: null,
    });
    useScheduleStore.setState({ tasks: {} });
  });

  it('shows recommended templates and creates them only after confirmation', () => {
    useDeepLinkStore.getState().setRuntimeSetup({
      name: 'new-media-ops',
      level: 'L2',
      profile: {
        version: 1,
        targetMaturity: 'L3',
        memory: { scope: 'project', autoCapture: ['feedback'] },
        workflows: [
          {
            id: 'weekly-review',
            kind: 'schedule',
            name: '每周内容复盘',
            description: '复盘本周表现',
            prompt: '执行每周内容复盘',
            recommended: true,
            schedule: {
              frequency: 'weekly',
              dayOfWeek: 3,
              time: { hour: 9, minute: 0 },
            },
          },
        ],
      },
    });

    render(<EmployeeRuntimeSetupDialog />);

    expect(screen.getByText('每周内容复盘')).toBeInTheDocument();
    expect(Object.keys(useScheduleStore.getState().tasks)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '创建并启用' }));

    expect(Object.values(useScheduleStore.getState().tasks)[0]?.name).toBe('每周内容复盘');
    expect(useDeepLinkStore.getState().runtimeSetup).toBeNull();
  });

  it('allows skipping automation setup without creating tasks', () => {
    useDeepLinkStore.getState().setRuntimeSetup({
      name: 'new-media-ops',
      level: 'L2',
      profile: {
        version: 1,
        workflows: [
          {
            id: 'weekly-review',
            kind: 'schedule',
            name: '每周内容复盘',
            prompt: '执行每周内容复盘',
            schedule: { frequency: 'weekly', dayOfWeek: 3 },
          },
        ],
      },
    });

    render(<EmployeeRuntimeSetupDialog />);
    fireEvent.click(screen.getByRole('button', { name: '暂不创建' }));

    expect(Object.keys(useScheduleStore.getState().tasks)).toHaveLength(0);
    expect(useDeepLinkStore.getState().runtimeSetup).toBeNull();
  });

  it('leaves a non-recommended template unchecked: confirm installs nothing', () => {
    useDeepLinkStore.getState().setRuntimeSetup({
      name: 'new-media-ops',
      level: 'L2',
      profile: {
        version: 1,
        workflows: [
          {
            id: 'weekly-review',
            kind: 'schedule',
            name: '每周内容复盘',
            prompt: '执行每周内容复盘',
            // no `recommended` → unchecked by default
            schedule: { frequency: 'weekly', dayOfWeek: 3 },
          },
        ],
      },
    });

    render(<EmployeeRuntimeSetupDialog />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: '创建并启用' }));
    expect(Object.keys(useScheduleStore.getState().tasks)).toHaveLength(0);
  });

  it('installs a non-recommended template once it is toggled on', () => {
    useDeepLinkStore.getState().setRuntimeSetup({
      name: 'new-media-ops',
      level: 'L2',
      profile: {
        version: 1,
        workflows: [
          {
            id: 'weekly-review',
            kind: 'schedule',
            name: '每周内容复盘',
            prompt: '执行每周内容复盘',
            schedule: { frequency: 'weekly', dayOfWeek: 3 },
          },
        ],
      },
    });

    render(<EmployeeRuntimeSetupDialog />);
    fireEvent.click(screen.getByRole('switch')); // opt in
    fireEvent.click(screen.getByRole('button', { name: '创建并启用' }));

    expect(Object.values(useScheduleStore.getState().tasks)[0]?.name).toBe('每周内容复盘');
  });
});
