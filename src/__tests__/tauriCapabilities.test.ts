/**
 * Tauri Capabilities Regression Guard
 *
 * Background: on macOS, Tauri's `tauri-plugin-fs` resolves scope path
 * variables (`$DESKTOP`, `$DOCUMENT`, `$DOWNLOAD`, ...) the moment the
 * plugin initializes. Because those three variables point to folders
 * that macOS TCC protects, declaring them in the scope caused macOS to
 * throw the "Abu wants to access Desktop folder" permission dialog the
 * instant the app launched — before the user did anything.
 *
 * Fix (this test guards): those paths are already covered by `$HOME/**`
 * on macOS and the Windows default layout, so removing the explicit
 * entries eliminates the startup prompt without losing access. macOS
 * TCC now fires only on first real file I/O to these folders, which is
 * the intended UX.
 *
 * If a future change re-adds `$DESKTOP`/`$DOCUMENT`/`$DOWNLOAD` paths,
 * this test fails and points future contributors to this explanation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const CAPABILITIES_PATH = path.resolve(
  __dirname,
  '../../src-tauri/capabilities/default.json'
);

interface PermissionObject {
  identifier?: string;
  allow?: Array<{ path?: string }>;
}

type Permission = string | PermissionObject;

interface Capabilities {
  permissions: Permission[];
}

function loadCapabilities(): Capabilities {
  return JSON.parse(fs.readFileSync(CAPABILITIES_PATH, 'utf-8'));
}

function collectScopePaths(permissions: Permission[]): string[] {
  const paths: string[] = [];
  for (const perm of permissions) {
    if (typeof perm !== 'object' || perm === null) continue;
    const allow = perm.allow;
    if (!Array.isArray(allow)) continue;
    for (const entry of allow) {
      if (entry && typeof entry.path === 'string') {
        paths.push(entry.path);
      }
    }
  }
  return paths;
}

describe('tauri capabilities — startup TCC regression guard', () => {
  const FORBIDDEN_ROOTS = ['$DESKTOP', '$DOCUMENT', '$DOWNLOAD'];

  it('does not declare $DESKTOP / $DOCUMENT / $DOWNLOAD scope paths (covered by $HOME/**)', () => {
    const paths = collectScopePaths(loadCapabilities().permissions);
    const violations = paths.filter((p) =>
      FORBIDDEN_ROOTS.some((root) => p.startsWith(root))
    );
    expect(violations).toEqual([]);
  });

  it('still declares $HOME/** so Desktop/Documents/Downloads remain reachable through the home directory', () => {
    const paths = collectScopePaths(loadCapabilities().permissions);
    expect(paths).toContain('$HOME/**');
  });
});
