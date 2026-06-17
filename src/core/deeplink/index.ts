/**
 * Deep-link entry point — wires the fuyao:// scheme into the app.
 *
 * Receives URLs from the tauri-plugin-deep-link event channel (covers cold
 * start via getCurrent inside onOpenUrl, and warm delivery forwarded by the
 * single-instance plugin), parses them, surfaces the main window, and stages
 * a pending install request for DeepLinkInstallDialog to confirm.
 */

import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { invoke } from '@tauri-apps/api/core';
import { parseDeepLink } from './parser';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import { useToastStore } from '@/stores/toastStore';
import { getI18n } from '@/i18n';

// The plugin can deliver the same URL twice around app start (initial
// getCurrent + event); drop repeats within a short window.
const DEDUP_WINDOW_MS = 3000;
let lastUrl: string | null = null;
let lastUrlAt = 0;

function handleUrl(raw: string): void {
  const now = Date.now();
  if (raw === lastUrl && now - lastUrlAt < DEDUP_WINDOW_MS) return;
  lastUrl = raw;
  lastUrlAt = now;

  // Whatever the link says, the user clicked something aimed at us —
  // surface the window so the outcome (dialog or error toast) is visible.
  invoke('window_show').catch(() => {});

  const result = parseDeepLink(raw);
  const t = getI18n();
  if (!result.ok) {
    console.warn(`[deeplink] Rejected ${raw}: ${result.code} — ${result.message}`);
    useToastStore.getState().addToast({
      type: 'error',
      title: t.deepLink.invalidLinkTitle,
      message: result.code === 'URL_NOT_ALLOWED' ? t.deepLink.unsupportedSource : t.deepLink.invalidLink,
    });
    return;
  }

  useDeepLinkStore.getState().setPending(result.request);
}

/**
 * Start listening for fuyao:// deep links. Called from an App boot effect;
 * the caller must invoke the returned unlisten on cleanup. No module-level
 * "already started" guard — under React StrictMode the boot effect runs
 * mount → cleanup → mount, and a guard would leave the second mount with no
 * live listener. Double delivery during the brief overlap is absorbed by the
 * URL dedup window in handleUrl.
 */
export async function initDeepLink(): Promise<(() => void) | null> {
  try {
    const unlisten = await onOpenUrl((urls) => {
      for (const url of urls) handleUrl(url);
    });
    const current = await getCurrent();
    for (const url of current ?? []) handleUrl(url);
    const queued = await invoke<string[]>('take_pending_deep_links');
    for (const url of queued ?? []) handleUrl(url);
    return unlisten;
  } catch (err) {
    // Browser dev mode (no Tauri) or plugin unavailable — deep links simply
    // don't arrive; not fatal.
    console.warn('[deeplink] onOpenUrl unavailable:', err);
    return null;
  }
}
