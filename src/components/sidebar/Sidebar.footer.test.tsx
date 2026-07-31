/**
 * Sidebar footer — avatar click routes to platform login when signed out.
 *
 * Guards the two things that are easy to silently re-break:
 *  1. signed out → avatar starts signIn() (used to open the local profile editor)
 *  2. signIn() swallows failures into store state; the sidebar must surface them
 *     as a toast, otherwise the click is a silent no-op.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '@/components/sidebar/Sidebar';
import { usePlatformAccountStore } from '@/stores/platformAccountStore';
import { useToastStore } from '@/stores/toastStore';
import enUS from '@/i18n/locales/en-US';

// Owned by other components / heavy children — not under test here.
vi.mock('@/components/sidebar/ContactList', () => ({ default: () => <div /> }));
vi.mock('@/components/sidebar/ProjectsSection', () => ({ default: () => <div /> }));
vi.mock('@/components/common/GuideModal', () => ({ default: () => null }));
vi.mock('@/components/common/ProfileEditModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="profile-modal" /> : null),
}));

function avatarButton(): HTMLElement {
  return screen.getByTitle(enUS.account.signIn);
}

describe('Sidebar footer', () => {
  // vitest.config.ts leaves `globals` off, so RTL's auto-cleanup never registers.
  afterEach(cleanup);

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    usePlatformAccountStore.setState({
      initialized: true,
      status: 'signed-out',
      user: null,
      session: null,
      devices: [],
      error: null,
    });
  });

  it('starts platform login when the avatar is clicked while signed out', async () => {
    const signIn = vi.fn(async () => {
      usePlatformAccountStore.setState({ status: 'signed-in' });
    });
    usePlatformAccountStore.setState({ signIn });

    render(<Sidebar />);
    await userEvent.click(avatarButton());

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('surfaces a toast when signIn fails (store swallows the error)', async () => {
    const signIn = vi.fn(async () => {
      usePlatformAccountStore.setState({ status: 'error', error: 'network down' });
    });
    usePlatformAccountStore.setState({ signIn });

    render(<Sidebar />);
    await userEvent.click(avatarButton());

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];
    expect(toast.type).toBe('error');
    expect(toast.title).toBe(enUS.account.signInFailed);
    expect(toast.message).toBe('network down');
  });

  it('does not re-invoke signIn while a login is already authorizing', async () => {
    const signIn = vi.fn(async () => {});
    usePlatformAccountStore.setState({ signIn, status: 'authorizing' });

    render(<Sidebar />);
    await userEvent.click(avatarButton());

    expect(signIn).not.toHaveBeenCalled();
  });

  it('opens the local profile editor instead of logging in when signed in', async () => {
    const signIn = vi.fn(async () => {});
    usePlatformAccountStore.setState({
      signIn,
      status: 'signed-in',
      user: { id: 'u1', phone: '13800001111', name: '测试用户', role: 'personal' },
    });

    render(<Sidebar />);
    await userEvent.click(screen.getByTitle(enUS.sidebar.editProfile));

    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByTestId('profile-modal')).toBeInTheDocument();
  });
});
