import fuyaoAvatar from '@/assets/fuyao-avatar.png';
import StatusLight from './StatusLight';
import { useStatusLight } from './useStatusLight';
import { usePetDrag } from './usePetDrag';
import { useI18n } from '@/i18n';

/**
 * Desktop pet root (Phase B).
 *
 * - Transparent 80×80 window renders the avatar PNG (designed shape).
 * - mousedown drags the window via Tauri's native startDragging.
 * - Edge-snap + position persistence handled inside usePetDrag.
 * - StatusLight ring reflects agent status aggregated from main window
 *   via Tauri event 'pet-status-update'.
 *
 * Interactions (click → mini input, double-click, right-click menu)
 * land in Phase C.
 */
export default function PetApp() {
  const dragRef = usePetDrag<HTMLDivElement>();
  const status = useStatusLight();
  const { t } = useI18n();

  return (
    <div
      ref={dragRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        cursor: 'grab',
      }}
    >
      <img
        src={fuyaoAvatar}
        alt={t.common.appName}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />
      <StatusLight status={status} />
    </div>
  );
}
