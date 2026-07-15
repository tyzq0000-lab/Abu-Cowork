import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmployeeRuntimeSetupDialog from './EmployeeRuntimeSetupDialog';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import { useScheduleStore } from '@/stores/scheduleStore';

const mocks = vi.hoisted(() => ({
  completeEmployeeDeployment: vi.fn().mockResolvedValue({
    conversationId: 'conversation-1',
    created: true,
  }),
}));

vi.mock('@/core/employee/deploymentFlow', () => ({
  checkEmployeeDependencies: vi.fn().mockResolvedValue([]),
  completeEmployeeDeployment: mocks.completeEmployeeDeployment,
  hasBlockingEmployeeDependencies: (health: Array<{ required: boolean; state: string }>) =>
    health.some((dependency) => dependency.required && dependency.state !== 'ready'),
}));

function setRuntimeSetup(recommended = false) {
  useDeepLinkStore.getState().setRuntimeSetup({
    name: 'generic-agent',
    packageId: 'generic-package',
    level: 'L2',
    profile: {
      version: 1,
      workflows: [
        {
          id: 'weekly-review',
          kind: 'schedule',
          name: 'Weekly review',
          prompt: 'Run the weekly review',
          recommended,
          schedule: { frequency: 'weekly', dayOfWeek: 3 },
        },
      ],
    },
  });
}

describe('EmployeeRuntimeSetupDialog', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.completeEmployeeDeployment.mockClear();
    useDeepLinkStore.setState({
      pending: null,
      installing: false,
      runtimeSetup: null,
    });
    useScheduleStore.setState({ tasks: {} });
  });

  it('creates recommended templates and opens the employee conversation', async () => {
    setRuntimeSetup(true);
    render(<EmployeeRuntimeSetupDialog />);

    expect(screen.getByText('Weekly review')).toBeInTheDocument();
    expect(Object.keys(useScheduleStore.getState().tasks)).toHaveLength(0);

    const confirm = await screen.findByRole('button', { name: '完成配置并开始工作' });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(useDeepLinkStore.getState().runtimeSetup).toBeNull());
    expect(Object.values(useScheduleStore.getState().tasks)[0]?.name).toBe('Weekly review');
    expect(mocks.completeEmployeeDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: 'generic-package',
        agentName: 'generic-agent',
      }),
    );
  });

  it('allows postponing setup without creating templates or conversations', () => {
    setRuntimeSetup(false);
    render(<EmployeeRuntimeSetupDialog />);
    fireEvent.click(screen.getByRole('button', { name: '稍后配置' }));

    expect(Object.keys(useScheduleStore.getState().tasks)).toHaveLength(0);
    expect(mocks.completeEmployeeDeployment).not.toHaveBeenCalled();
    expect(useDeepLinkStore.getState().runtimeSetup).toBeNull();
  });

  it('leaves a non-recommended template unchecked', async () => {
    setRuntimeSetup(false);
    render(<EmployeeRuntimeSetupDialog />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');

    const confirm = screen.getByRole('button', { name: '完成配置并开始工作' });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.completeEmployeeDeployment).toHaveBeenCalledOnce());
    expect(Object.keys(useScheduleStore.getState().tasks)).toHaveLength(0);
  });

  it('installs a non-recommended template after opt-in', async () => {
    setRuntimeSetup(false);
    render(<EmployeeRuntimeSetupDialog />);
    fireEvent.click(screen.getByRole('switch'));

    const confirm = screen.getByRole('button', { name: '完成配置并开始工作' });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.completeEmployeeDeployment).toHaveBeenCalledOnce());
    expect(Object.values(useScheduleStore.getState().tasks)[0]?.name).toBe('Weekly review');
  });
});
