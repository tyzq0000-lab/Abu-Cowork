import type { PetStatus } from './useStatusLight';

/**
 * Status light ring rendered around the pet avatar (Phase B).
 *
 * idle     → no visual (transparent), so users aren't distracted when
 *            there's nothing happening
 * running  → blue, 2s breathe animation
 * waiting  → orange, 0.8s pulse (reserved, wired in Phase D)
 * error    → red, static
 * done     → green, 10s fade to idle (CSS animation-fill: forwards)
 *
 * The ring is an absolutely-positioned overlay on top of the avatar
 * using box-shadow inset for the ring effect (no extra DOM elements).
 */

const RING_COLOR: Record<PetStatus, string | null> = {
  idle: null,
  running: 'rgba(56, 152, 255, 0.85)',
  waiting: 'rgba(255, 160, 40, 0.9)',
  error: 'rgba(240, 70, 70, 0.9)',
  done: 'rgba(80, 200, 110, 0.85)',
};

const ANIMATION: Record<PetStatus, string | null> = {
  idle: null,
  running: 'petBreathe 2s ease-in-out infinite',
  waiting: 'petPulse 0.8s ease-in-out infinite',
  error: null,
  done: 'petDoneFade 10s ease-out forwards',
};

export default function StatusLight({ status }: { status: PetStatus }) {
  const color = RING_COLOR[status];
  const animation = ANIMATION[status];

  if (!color) return null;

  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          boxShadow: `inset 0 0 0 3px ${color}, 0 0 12px ${color}`,
          pointerEvents: 'none',
          animation: animation ?? undefined,
        }}
      />
      <style>{`
        @keyframes petBreathe {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @keyframes petPulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.03); }
        }
        @keyframes petDoneFade {
          0% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
}
