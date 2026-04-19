/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegistryBrowserModal from './RegistryBrowserModal';
import {
  __resetAdaptersForTests,
  registerAdapter,
  type RegistryAdapter,
} from '@/core/skill/registries';

const mockAddToast = vi.fn();

vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

function makeAdapter(id: string, overrides: Partial<RegistryAdapter> = {}): RegistryAdapter {
  return {
    id,
    displayName: `${id} Market`,
    description: `${id} description`,
    capabilities: { canList: true, canSearch: true, requiresAuth: false },
    isAvailable: async () => true,
    install: async () => new Uint8Array(),
    ...overrides,
  };
}

const onClose = vi.fn();

beforeEach(() => {
  __resetAdaptersForTests();
  mockAddToast.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('RegistryBrowserModal', () => {
  it('shows the empty-state copy when no adapters are registered', async () => {
    render(<RegistryBrowserModal onClose={onClose} />);
    // The placeholder explains what will land here later — don't
    // render a confusing "empty list" with no context.
    expect(await screen.findByText(/No registries connected yet/)).toBeInTheDocument();
    expect(screen.getByText(/CLAWhub/)).toBeInTheDocument();
  });

  it('renders each registered adapter with availability status', async () => {
    registerAdapter(makeAdapter('clawhub', { isAvailable: async () => true }));
    registerAdapter(makeAdapter('other', { isAvailable: async () => false }));

    render(<RegistryBrowserModal onClose={onClose} />);

    expect(await screen.findByText('clawhub Market')).toBeInTheDocument();
    expect(screen.getByText('other Market')).toBeInTheDocument();
    // Availability badges differ per row.
    expect(screen.getByText(/Available/)).toBeInTheDocument();
    expect(screen.getByText(/Not configured/)).toBeInTheDocument();
  });

  it('renders a "Login required" badge when the adapter needs auth', async () => {
    registerAdapter(
      makeAdapter('private', {
        capabilities: { canList: true, canSearch: true, requiresAuth: true },
      }),
    );
    render(<RegistryBrowserModal onClose={onClose} />);
    expect(await screen.findByText(/Login required/)).toBeInTheDocument();
  });

  it('clicking an available adapter surfaces the "coming soon" toast (D-UI placeholder)', async () => {
    registerAdapter(makeAdapter('clawhub', { isAvailable: async () => true }));
    const user = userEvent.setup();
    render(<RegistryBrowserModal onClose={onClose} />);

    await user.click(await screen.findByRole('button', { name: /clawhub Market/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          title: expect.stringContaining('ship soon'),
          message: 'clawhub Market',
        }),
      );
    });
  });

  it('clicking an unavailable adapter does nothing (no toast, no navigation)', async () => {
    // Regression guard: unavailable rows are disabled buttons; they
    // must not trigger the browse handler or the user gets confused
    // about why nothing happened.
    registerAdapter(makeAdapter('offline', { isAvailable: async () => false }));
    const user = userEvent.setup();
    render(<RegistryBrowserModal onClose={onClose} />);

    const row = await screen.findByRole('button', { name: /offline Market/i });
    await user.click(row);

    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('backdrop click closes the modal', async () => {
    const user = userEvent.setup();
    const { container } = render(<RegistryBrowserModal onClose={onClose} />);
    await screen.findByText(/No registries connected yet/);

    const backdrop = container.firstChild as HTMLElement;
    await user.pointer({ keys: '[MouseLeft>]', target: backdrop });
    await user.pointer({ keys: '[/MouseLeft]', target: backdrop });

    expect(onClose).toHaveBeenCalled();
  });
});
