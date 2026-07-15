import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatHeader from './ChatHeader';

describe('ChatHeader employee growth actions', () => {
  afterEach(cleanup);

  it('exposes icon actions with accessible labels and dispatches them', () => {
    const runDream = vi.fn();
    const importKnowledge = vi.fn();
    render(
      <ChatHeader
        contactKey={null}
        onOpenHistory={() => undefined}
        onRunDream={runDream}
        onImportKnowledge={importKnowledge}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /导入员工知识|Import employee knowledge/ }));
    fireEvent.click(screen.getByRole('button', { name: /运行员工自省|Run employee reflection/ }));
    expect(importKnowledge).toHaveBeenCalledOnce();
    expect(runDream).toHaveBeenCalledOnce();
  });

  it('disables both actions while one operation is running', () => {
    render(
      <ChatHeader
        contactKey={null}
        onOpenHistory={() => undefined}
        onRunDream={() => undefined}
        onImportKnowledge={() => undefined}
        actionBusy="dream"
      />,
    );

    expect(screen.getByRole('button', { name: /导入员工知识|Import employee knowledge/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /运行员工自省|Run employee reflection/ })).toBeDisabled();
  });
});
