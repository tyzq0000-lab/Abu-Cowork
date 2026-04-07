import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Tauri APIs before importing the module
vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
}));

// Reset cached path between tests by re-importing
describe('pythonRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveCommandPython', () => {
    it('replaces python3 at start of command', async () => {
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(resolveResource).mockResolvedValue('/app/Resources/python-runtime/bin/python3');
      vi.mocked(exists).mockResolvedValue(true);

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('python3 /tmp/build_ppt.py');
      expect(result).toBe('/app/Resources/python-runtime/bin/python3 -I /tmp/build_ppt.py');
    });

    it('replaces python at start of command', async () => {
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(resolveResource).mockResolvedValue('/app/Resources/python-runtime/bin/python3');
      vi.mocked(exists).mockResolvedValue(true);

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('python -c "print(1)"');
      expect(result).toBe('/app/Resources/python-runtime/bin/python3 -I -c "print(1)"');
    });

    it('does not replace python inside a path', async () => {
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(resolveResource).mockResolvedValue('/app/Resources/python-runtime/bin/python3');
      vi.mocked(exists).mockResolvedValue(true);

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('/usr/bin/python3 script.py');
      expect(result).toBe('/usr/bin/python3 script.py');
    });

    it('does not replace non-python commands', async () => {
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(resolveResource).mockResolvedValue('/app/Resources/python-runtime/bin/python3');
      vi.mocked(exists).mockResolvedValue(true);

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('node build_ppt.js');
      expect(result).toBe('node build_ppt.js');
    });

    it('returns command unchanged when embedded python not available', async () => {
      const { resolveResource } = await import('@tauri-apps/api/path');
      vi.mocked(resolveResource).mockRejectedValue(new Error('not found'));

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('python3 script.py');
      expect(result).toBe('python3 script.py');
    });

    it('quotes path with spaces', async () => {
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(resolveResource).mockResolvedValue('/app/My Resources/python-runtime/bin/python3');
      vi.mocked(exists).mockResolvedValue(true);

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('python3 script.py');
      expect(result).toBe('"/app/My Resources/python-runtime/bin/python3" -I script.py');
    });
  });

  // ── Windows-specific ──
  // Note: setPlatformForTest must be called AFTER vi.resetModules() + re-import,
  // because resetModules clears spy targets. Instead we mock the platform module directly.
  describe('Windows platform', () => {
    it('resolves python.exe on Windows', async () => {
      // Mock platform inline for this fresh module import
      vi.doMock('./platform', () => ({
        isWindows: () => true,
        isMacOS: () => false,
        getPlatform: () => 'windows',
      }));
      const { resolveResource } = await import('@tauri-apps/api/path');
      vi.mocked(resolveResource).mockResolvedValue('C:\\app\\python-runtime\\python.exe');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(exists).mockResolvedValue(true);

      const { getEmbeddedPythonPath } = await import('./pythonRuntime');
      const path = await getEmbeddedPythonPath();
      expect(resolveResource).toHaveBeenCalledWith('python-runtime/python.exe');
      expect(path).toBe('C:\\app\\python-runtime\\python.exe');
    });

    it('resolves bin/python3 on macOS', async () => {
      vi.doMock('./platform', () => ({
        isWindows: () => false,
        isMacOS: () => true,
        getPlatform: () => 'macos',
      }));
      const { resolveResource } = await import('@tauri-apps/api/path');
      vi.mocked(resolveResource).mockResolvedValue('/app/python-runtime/bin/python3');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(exists).mockResolvedValue(true);

      const { getEmbeddedPythonPath } = await import('./pythonRuntime');
      const path = await getEmbeddedPythonPath();
      expect(resolveResource).toHaveBeenCalledWith('python-runtime/bin/python3');
      expect(path).toBe('/app/python-runtime/bin/python3');
    });

    it('replaces python with Windows embedded path', async () => {
      vi.doMock('./platform', () => ({
        isWindows: () => true,
        isMacOS: () => false,
        getPlatform: () => 'windows',
      }));
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(resolveResource).mockResolvedValue('C:\\app\\python-runtime\\python.exe');
      vi.mocked(exists).mockResolvedValue(true);

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('python script.py');
      expect(result).toBe('C:\\app\\python-runtime\\python.exe -I script.py');
    });

    it('quotes Windows path with spaces', async () => {
      vi.doMock('./platform', () => ({
        isWindows: () => true,
        isMacOS: () => false,
        getPlatform: () => 'windows',
      }));
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      vi.mocked(resolveResource).mockResolvedValue('C:\\Program Files\\Abu\\python-runtime\\python.exe');
      vi.mocked(exists).mockResolvedValue(true);

      const { resolveCommandPython } = await import('./pythonRuntime');
      const result = await resolveCommandPython('python3 test.py');
      expect(result).toBe('"C:\\Program Files\\Abu\\python-runtime\\python.exe" -I test.py');
    });
  });
});
