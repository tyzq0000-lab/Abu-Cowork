/**
 * Clawhub adapter — browser-handoff only (v0.14 MVP).
 *
 * Clawhub (https://clawhub.ai) is a public Claude skills marketplace.
 * The site doesn't expose a public machine-readable API as of this
 * writing (Convex backend, no advertised docs), so the adapter sits
 * in the "externalBrowseUrl" mode: clicking it in the registry
 * browser just opens the Clawhub site in the user's default browser.
 *
 * The install path is lowest-common-denominator: user downloads a
 * `.askill` file from clawhub.ai, then imports it via the existing
 * Toolbox import flow (Task #25 B). `list()` / `find()` / `install()`
 * are intentionally unimplemented — UI surfaces the browse URL and
 * never calls them.
 *
 * If Clawhub ships an API later, the adapter can be upgraded in
 * place: drop `externalBrowseUrl`, flip `canList` / `canSearch`,
 * fill in the fetcher methods. All UI callsites already branch on
 * `externalBrowseUrl`, so no call-site changes are needed.
 */

import type { RegistryAdapter } from './types';

export const CLAWHUB_URL = 'https://clawhub.ai';

export const clawhubAdapter: RegistryAdapter = {
  id: 'clawhub',
  displayName: 'Clawhub',
  // Kept short — shown as secondary text under the row title in the
  // browser modal. Longer marketing copy belongs on the Clawhub page
  // itself, not in the adapter's metadata.
  description: '公开的 Claude 技能市场 · 从官网下载 .askill 后导入',
  capabilities: {
    // No API → no programmatic list/search. UI must branch on
    // externalBrowseUrl to avoid rendering disabled controls.
    canList: false,
    canSearch: false,
    requiresAuth: false,
  },
  externalBrowseUrl: CLAWHUB_URL,
  // Browser-handoff mode is always "available" — we only need the
  // system default browser, which every target platform has. The
  // network reachability of clawhub.ai itself is the user's concern
  // (if it's unreachable, the browser will show that, not Abu).
  isAvailable: async () => true,
  install: async () => {
    // Defensive: the UI shouldn't reach here because the row opens
    // externalBrowseUrl before trying to install. If a future caller
    // does hit this, fail explicitly rather than silently.
    throw new Error(
      'Clawhub is browser-handoff only. Download the .askill file from clawhub.ai and use Toolbox → Import .askill.',
    );
  },
};
