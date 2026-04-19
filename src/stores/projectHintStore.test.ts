import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectHintStore } from './projectHintStore';

describe('projectHintStore', () => {
  beforeEach(() => {
    useProjectHintStore.setState({ dismissedWorkspaces: [] });
  });

  it('dismiss adds the workspace to the dismissed list', () => {
    useProjectHintStore.getState().dismiss('/Users/test/da');
    expect(useProjectHintStore.getState().dismissedWorkspaces).toEqual(['/Users/test/da']);
  });

  it('dismiss is idempotent — repeated dismisses do not create duplicates', () => {
    // Regression guard: the hint component can rerender multiple times
    // while the user is still on the welcome page, and without the set
    // check we'd end up with a fat persisted list that bloats localStorage
    // on every session.
    useProjectHintStore.getState().dismiss('/Users/test/da');
    useProjectHintStore.getState().dismiss('/Users/test/da');
    useProjectHintStore.getState().dismiss('/Users/test/da');
    expect(useProjectHintStore.getState().dismissedWorkspaces).toEqual(['/Users/test/da']);
  });

  it('dismiss tracks multiple distinct workspaces independently', () => {
    useProjectHintStore.getState().dismiss('/Users/test/a');
    useProjectHintStore.getState().dismiss('/Users/test/b');
    expect(useProjectHintStore.getState().dismissedWorkspaces).toEqual([
      '/Users/test/a',
      '/Users/test/b',
    ]);
  });

  it('clearDismissed wipes the list', () => {
    useProjectHintStore.getState().dismiss('/Users/test/da');
    useProjectHintStore.getState().dismiss('/Users/test/other');
    useProjectHintStore.getState().clearDismissed();
    expect(useProjectHintStore.getState().dismissedWorkspaces).toEqual([]);
  });
});
