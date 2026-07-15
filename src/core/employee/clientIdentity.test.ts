import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getOrCreateClientId, isValidClientId } from './clientIdentity';

describe('stable platform client identity', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset().mockResolvedValue(false);
    vi.mocked(readTextFile).mockReset().mockResolvedValue('');
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockReset().mockResolvedValue(undefined);
  });

  it('reuses a valid persisted UUID', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue('11111111-1111-4111-8111-111111111111\n');
    expect(await getOrCreateClientId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it('creates and persists a UUID when missing or corrupt', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue('not-a-client-id');
    const id = await getOrCreateClientId();
    expect(isValidClientId(id)).toBe(true);
    expect(mkdir).toHaveBeenCalledWith('platform', expect.objectContaining({ recursive: true }));
    expect(writeTextFile).toHaveBeenCalledWith(
      'platform/client-id.txt',
      id,
      expect.objectContaining({ baseDir: expect.anything() }),
    );
  });
});
