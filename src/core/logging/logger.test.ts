import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeTextFile } from '@tauri-apps/plugin-fs';

describe('logger disk persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes under the app-data logs directory', async () => {
    const { createLogger } = await import('./logger');
    createLogger('test').error('boom');
    await vi.advanceTimersByTimeAsync(600);

    const paths = vi.mocked(writeTextFile).mock.calls.map(([path]) => String(path));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^\/Users\/testuser\/\.abu\/logs\//);
    expect(paths[0]).not.toContain('.abulogs');
  });
});
