/**
 * Build a loopback HTTP URL for previewing a local file in a sandboxed iframe.
 *
 * Background: WKWebView refuses to serve asset:// sub-resources from sandboxed
 * iframes, so HTML previews can't use Tauri's built-in asset protocol when the
 * HTML has any local relative refs (./chart.js, ./style.css, etc.). The Rust
 * preview_server module exposes a loopback HTTP server that solves this —
 * http:// is a standard scheme so sandbox + sub-resources both work.
 *
 * Flow:
 *   1. Lazy-fetch (port, token) from Tauri on first call; cache for app lifetime.
 *   2. Register the file's parent directory as a root (idempotent — same path
 *      → same root_id from Rust hashing).
 *   3. Build URL: http://127.0.0.1:{port}/files/{token}/{root_id}/{filename}
 *
 * Returns null if the server didn't start (logged in console; iframe will
 * show a fallback).
 */

import { invoke } from '@tauri-apps/api/core';
import { getParentDir, getBaseName, normalizeSeparators } from './pathUtils';

interface PreviewServerInfo {
  port: number;
  token: string;
}

let serverInfoPromise: Promise<PreviewServerInfo | null> | null = null;

function getServerInfo(): Promise<PreviewServerInfo | null> {
  if (serverInfoPromise) return serverInfoPromise;
  serverInfoPromise = invoke<PreviewServerInfo>('get_preview_server_info')
    .catch((err) => {
      console.error('[previewUrl] get_preview_server_info failed:', err);
      // Don't permanently cache failure — let next preview retry.
      serverInfoPromise = null;
      return null;
    });
  return serverInfoPromise;
}

/**
 * Build a preview URL for a local file. Returns null on failure.
 *
 * Each call registers the file's parent dir as a preview root. The Rust side
 * dedupes by canonical path (same dir → same root_id) and LRU-evicts the
 * oldest if more than MAX_ROOTS (16) are registered.
 */
export async function buildPreviewUrl(filePath: string): Promise<string | null> {
  const info = await getServerInfo();
  if (!info) return null;

  const normalized = normalizeSeparators(filePath);
  const dir = getParentDir(normalized);
  const name = getBaseName(normalized);

  let rootId: string;
  try {
    rootId = await invoke<string>('register_preview_root', { path: dir });
  } catch (err) {
    console.error('[previewUrl] register_preview_root failed:', err, 'dir:', dir);
    return null;
  }

  // Per-segment percent-encode so '/' stays as URL path separator. Filename
  // is a single segment so we encode it whole.
  return `http://127.0.0.1:${info.port}/files/${info.token}/${rootId}/${encodeURIComponent(name)}`;
}
