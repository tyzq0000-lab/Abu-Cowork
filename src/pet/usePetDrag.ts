/**
 * Pet drag + edge snap (Phase B).
 *
 * Tauri's `startDragging()` transfers the mouse drag to the native window
 * manager, so we don't see mousemove/mouseup on the DOM side. We rely on
 * `onMoved` events to know where the window ended up, then debounce the
 * tail move to persist position + apply edge snap.
 *
 * Edge snap: when the pet stops within 20px of a screen edge, we snap
 * it to hide 40% of its body off-screen (PRD-02 "docked" feel).
 *
 * Position persistence: localStorage in the pet window's own WebView.
 * Phase D will migrate this to settingsStore via cross-window event.
 */

import { useEffect, useRef } from 'react';
import { getCurrentWindow, primaryMonitor, PhysicalPosition } from '@tauri-apps/api/window';

const STORAGE_KEY = 'abu-pet-position';
const SNAP_THRESHOLD = 20;
const HIDE_RATIO = 0.4;
const DEBOUNCE_MS = 220;
const PET_SIZE = 80;

interface Stored {
  x: number;
  y: number;
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveStored(pos: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // Quota / privacy mode — ignore, position is non-critical.
  }
}

async function resolveSnap(x: number, y: number): Promise<Stored> {
  const monitor = await primaryMonitor();
  if (!monitor) return { x, y };

  // Monitor size is physical; getCurrentWindow positions are physical too.
  const { width: screenW, height: screenH } = monitor.size;
  const scale = monitor.scaleFactor ?? 1;
  const petPhysical = PET_SIZE * scale;
  const snapPhysical = SNAP_THRESHOLD * scale;
  const hidePhysical = Math.round(petPhysical * HIDE_RATIO);

  let snapX = x;
  let snapY = y;

  // Left edge
  if (x < snapPhysical) {
    snapX = -hidePhysical;
  }
  // Right edge
  if (x + petPhysical > screenW - snapPhysical) {
    snapX = screenW - petPhysical + hidePhysical;
  }
  // Clamp vertical to stay on-screen
  if (y < 0) snapY = 0;
  if (y + petPhysical > screenH) snapY = Math.max(0, screenH - petPhysical);

  return { x: snapX, y: snapY };
}

/**
 * Wire up drag-to-move + edge-snap + position-persist on the pet window.
 *
 * Returns a ref that callers bind to the draggable surface (`<div ref={...}>`).
 * Mousedown on that surface calls Tauri's `startDragging()`.
 */
export function usePetDrag<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  // Restore last position once at mount.
  useEffect(() => {
    const stored = loadStored();
    if (!stored) return;
    getCurrentWindow()
      .setPosition(new PhysicalPosition(stored.x, stored.y))
      .catch(() => {});
  }, []);

  // Mousedown → startDragging.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      // Left button only; right-click reserved for menu (Phase C).
      if (e.button !== 0) return;
      getCurrentWindow().startDragging().catch(() => {});
    };

    el.addEventListener('mousedown', onMouseDown);
    return () => el.removeEventListener('mousedown', onMouseDown);
  }, []);

  // onMoved → debounce → snap + persist.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    let timer: number | null = null;

    getCurrentWindow()
      .onMoved(({ payload }) => {
        if (timer !== null) clearTimeout(timer);
        timer = window.setTimeout(async () => {
          const snapped = await resolveSnap(payload.x, payload.y);
          if (snapped.x !== payload.x || snapped.y !== payload.y) {
            getCurrentWindow()
              .setPosition(new PhysicalPosition(snapped.x, snapped.y))
              .catch(() => {});
          }
          saveStored(snapped);
        }, DEBOUNCE_MS);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  return ref;
}
