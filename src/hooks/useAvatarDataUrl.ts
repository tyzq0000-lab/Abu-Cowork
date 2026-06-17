import { useEffect, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { isImageAvatarPath } from '@/core/agent/employeeLoader';

// Module-level cache so the same avatar file is read once per app session.
const dataUrlCache = new Map<string, string>();

function extToMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'svg': return 'image/svg+xml';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Resolve an image-path avatar to a `data:` URL by reading the file through the
 * Tauri fs plugin. Emoji avatars (no path/extension) return null.
 *
 * Why data URLs instead of `convertFileSrc`: the asset protocol is unreliable in
 * the dev webview and adds a cross-origin dependency. A data URL is allowed by the
 * app CSP (`img-src ... data:`) and renders identically in dev and production, so
 * any employee package shipping an image avatar renders without per-path scope
 * tweaks.
 */
export function useAvatarDataUrl(avatar: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    avatar ? dataUrlCache.get(avatar) ?? null : null,
  );

  useEffect(() => {
    if (!avatar || !isImageAvatarPath(avatar)) {
      setSrc(null);
      return;
    }
    const cached = dataUrlCache.get(avatar);
    if (cached) {
      setSrc(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await readFile(avatar);
        const dataUrl = `data:${extToMime(avatar)};base64,${bytesToBase64(bytes)}`;
        dataUrlCache.set(avatar, dataUrl);
        if (!cancelled) setSrc(dataUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [avatar]);

  return src;
}
