/**
 * Source-to-UX-category mapping.
 *
 * The Toolbox shows 4 top-level skill buckets (`SkillUXCategory`):
 *
 *   - **mine** — user/standard/project/project-standard. Everything
 *     the human (or their team's repo) explicitly put on disk.
 *   - **agent-evolved** — workspace-auto + draft. Everything Abu's
 *     self-evolution produced. Kept separate from `mine` so users
 *     can tell "I made this" from "Abu made this".
 *   - **third-party** — installed from a registry (CLAWhub, future
 *     sources). Empty in MVP; reserved for v0.14+.
 *   - **builtin** — bundled with the app binary.
 *
 * All Toolbox grouping goes through this function, so the enum-to-
 * bucket mapping stays in one place and it's hard to forget a new
 * source (unknown values log a warning instead of silently landing
 * in `mine`, which was the pre-refactor bug where workspace-auto
 * skills looked like user-created ones).
 */

import type { SkillSource, SkillUXCategory } from '../../types';

export function sourceToUXCategory(source: SkillSource | undefined): SkillUXCategory | null {
  switch (source) {
    case 'user':
    case 'standard':
    case 'project':
    case 'project-standard':
      return 'mine';
    case 'workspace-auto':
    case 'draft':
      return 'agent-evolved';
    case 'third-party':
      return 'third-party';
    case 'builtin':
      return 'builtin';
    case undefined:
      // Legacy skills loaded before `source` was populated. Treat as
      // "mine" — matches historical behavior for un-tagged files.
      return 'mine';
    default: {
      // Exhaustiveness guard — if SkillSource grows a new member
      // and this switch isn't updated, TS narrows to `never` and
      // the assignment fails at build time. We also log at runtime
      // so mislabeled on-disk skills don't silently disappear.
      const _exhaustive: never = source;
      void _exhaustive;
      console.warn(
        `[sourceToUXCategory] unknown skill source "${String(source)}" — skill will be hidden`,
      );
      return null;
    }
  }
}
