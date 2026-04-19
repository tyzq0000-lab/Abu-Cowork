import abuAvatar from '@/assets/abu-avatar.png';

/**
 * Desktop pet root (Phase A).
 *
 * Renders the abu-avatar PNG as-is inside an 80×80 transparent window.
 * The PNG already ships with a rounded-rect card + soft shadow baked in,
 * so no further clipping needed — the window is transparent and only
 * the designed avatar shape shows on the desktop.
 *
 * Interactions (drag, click, status light, mini input) land in Phase B/C.
 */
export default function PetApp() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
      }}
    >
      <img
        src={abuAvatar}
        alt="Abu"
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
