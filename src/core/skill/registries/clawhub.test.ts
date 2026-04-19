import { describe, it, expect } from 'vitest';
import { clawhubAdapter, CLAWHUB_URL } from './clawhub';

describe('clawhubAdapter', () => {
  it('declares itself as browser-handoff (no list/search)', () => {
    expect(clawhubAdapter.capabilities).toEqual({
      canList: false,
      canSearch: false,
      requiresAuth: false,
    });
    expect(clawhubAdapter.externalBrowseUrl).toBe(CLAWHUB_URL);
  });

  it('is always available — browser-handoff has no runtime dependency', async () => {
    // Regression guard: if some future refactor makes this do network
    // probing, it must still never throw. Adapters are contract-bound
    // to return false instead of throwing on probe failure.
    await expect(clawhubAdapter.isAvailable()).resolves.toBe(true);
  });

  it('install() throws with an actionable error (defensive — UI should not call this)', async () => {
    await expect(clawhubAdapter.install('foo')).rejects.toThrow(/browser-handoff|download.*askill/i);
  });

  it('uses the stable primary Clawhub URL', () => {
    expect(CLAWHUB_URL).toBe('https://clawhub.ai');
  });
});
