/**
 * Branding constants — single source of truth for product naming and
 * brand-derived file/directory names.
 *
 * This module exists so upstream merges stay mechanical: conflicts around
 * brand literals collapse into "keep our constant reference" (see
 * docs/UPSTREAM-SYNC.md). Pure constants, no logic.
 *
 * LEGACY_* values identify artifacts created by older builds (or by the
 * upstream Abu-Cowork project) and are read-compatibility only — never
 * write new data under a LEGACY name.
 */

/** Product display name (zh) — user-facing. */
export const PRODUCT_NAME = '扶摇';

/** Product display name (en) — user-facing. */
export const PRODUCT_NAME_EN = 'Fuyao';

/** Home-level data directory name: ~/.uprow (shared by future uprow products). */
export const DATA_DIR_NAME = '.uprow';

/** Pre-rename home data directory (~/.abu) — migration detection only. */
export const LEGACY_DATA_DIR_NAME = '.abu';

/**
 * Workspace-level dot directory inside user projects ({workspace}/.abu).
 * Deliberately unchanged this round: renaming would orphan the rules/memory
 * of every existing project. Tracked as a possible future rename.
 */
export const WORKSPACE_DIR_NAME = '.abu';

/** Project rules filename inside the workspace/home dot dir. */
export const RULES_FILENAME = 'FUYAO.md';

/** Pre-rename rules filename — read fallback only. */
export const LEGACY_RULES_FILENAME = 'ABU.md';

/** Conversation share bundle extension. */
export const SHARE_EXT = '.fuyao.json';

/** Pre-rename share extension — import compatibility only. */
export const LEGACY_SHARE_EXT = '.abu.json';
