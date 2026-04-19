/**
 * Pet status light subscription (Phase B).
 *
 * Listens to 'pet-status-update' events emitted by petStatusBridge in the
 * main window. On mount, emits 'pet-resync-request' so the main window
 * re-broadcasts the current status (handles the case where main emitted
 * before the pet window was open).
 */

import { useEffect, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';

export type PetStatus = 'idle' | 'running' | 'waiting' | 'error' | 'done';

interface StatusPayload {
  status: PetStatus;
}

export function useStatusLight(): PetStatus {
  const [status, setStatus] = useState<PetStatus>('idle');

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    listen<StatusPayload>('pet-status-update', ({ payload }) => {
      setStatus(payload.status);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    // Ask main window for the current status on mount.
    emit('pet-resync-request').catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return status;
}
