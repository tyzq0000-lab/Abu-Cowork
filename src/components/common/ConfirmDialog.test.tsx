import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

function renderDialog(width?: number) {
  render(
    <ConfirmDialog
      open
      title="Title"
      message={<p data-testid="body-content">Body</p>}
      confirmText="OK"
      cancelText="Cancel"
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      width={width}
    />,
  );
  const confirmButton = screen.getByRole('button', { name: 'OK' });
  const footer = confirmButton.parentElement as HTMLElement;
  const card = footer.parentElement as HTMLElement;
  const body = screen.getByTestId('body-content').parentElement as HTMLElement;
  return { card, body, footer, confirmButton };
}

describe('ConfirmDialog', () => {
  afterEach(cleanup);

  // Regression guard for the flex-centering overflow trap: a card taller than the
  // viewport used to push its footer off-screen with no way to scroll to it.
  describe('overflow containment', () => {
    it('caps the card height and scrolls the body, not the whole card', () => {
      const { card, body } = renderDialog();
      expect(card.className).toContain('max-h-[85vh]');
      expect(card.className).toContain('flex-col');
      expect(body.className).toContain('overflow-y-auto');
      expect(body.className).toContain('min-h-0');
      // The card itself must never be the scroller — that reintroduces the bug.
      expect(card.className).not.toContain('overflow-y-auto');
    });

    it('keeps the footer buttons outside the scrollable body', () => {
      const { body, footer, confirmButton } = renderDialog();
      expect(body.contains(confirmButton)).toBe(false);
      expect(body.contains(footer)).toBe(false);
      expect(footer.className).toContain('shrink-0');
    });
  });

  describe('width', () => {
    it('defaults to 360px so existing call sites are unchanged', () => {
      const { card } = renderDialog();
      expect(card.style.width).toBe('360px');
      expect(card.className).toContain('max-w-[calc(100vw-2rem)]');
    });

    it('honors an explicit width', () => {
      const { card } = renderDialog(540);
      expect(card.style.width).toBe('540px');
    });
  });

  it('renders into document.body via portal', () => {
    renderDialog();
    // ProviderCard sits inside a transformed ScrollArea; the backdrop must be a
    // direct child of <body> for `fixed inset-0` to resolve against the viewport.
    const backdrop = screen.getByTestId('body-content').closest('.fixed');
    expect(backdrop?.parentElement).toBe(document.body);
  });
});
