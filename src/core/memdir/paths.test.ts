import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizePath, getMemoryDir, getMemoryEntrypoint, isMemoryPath, _resetCachedHome } from './paths';

beforeEach(() => {
  _resetCachedHome();
});

describe('sanitizePath', () => {
  it('replaces non-alphanumeric chars with hyphens', () => {
    expect(sanitizePath('/Users/didi/Documents/my-project')).toBe('-Users-didi-Documents-my-project');
  });

  it('handles Windows-style paths', () => {
    expect(sanitizePath('C:\\Users\\test\\project')).toBe('C--Users-test-project');
  });

  it('truncates long paths and appends hash', () => {
    const longPath = '/a'.repeat(300);
    const result = sanitizePath(longPath);
    expect(result.length).toBeLessThan(220);
    expect(result).toContain('-'); // hash suffix
  });

  it('returns short paths unchanged (except sanitization)', () => {
    expect(sanitizePath('simple')).toBe('simple');
  });
});

describe('getMemoryDir', () => {
  it('returns global memory dir when no workspace', async () => {
    const dir = await getMemoryDir(null);
    expect(dir).toBe('/Users/testuser/.abu/memory');
  });

  it('returns global memory dir when undefined', async () => {
    const dir = await getMemoryDir(undefined);
    expect(dir).toBe('/Users/testuser/.abu/memory');
  });

  it('returns project memory dir with sanitized workspace path', async () => {
    const dir = await getMemoryDir('/Users/didi/Desktop/Test');
    expect(dir).toContain('/.abu/projects/');
    expect(dir).toContain('/memory');
    expect(dir).not.toContain(' '); // should be sanitized
  });
});

describe('getMemoryEntrypoint', () => {
  it('returns MEMORY.md path in global dir', async () => {
    const path = await getMemoryEntrypoint(null);
    expect(path).toBe('/Users/testuser/.abu/memory/MEMORY.md');
  });

  it('returns MEMORY.md path in workspace dir', async () => {
    const path = await getMemoryEntrypoint('/workspace');
    expect(path).toContain('/MEMORY.md');
    expect(path).toContain('/projects/');
  });
});

describe('isMemoryPath', () => {
  it('matches global memory dir', async () => {
    expect(await isMemoryPath('/Users/testuser/.abu/memory/test.md')).toBe(true);
  });

  it('matches global memory dir root', async () => {
    expect(await isMemoryPath('/Users/testuser/.abu/memory')).toBe(true);
  });

  it('matches project memory dir', async () => {
    expect(await isMemoryPath('/Users/testuser/.abu/projects/some-key/memory/test.md')).toBe(true);
  });

  it('rejects non-memory paths under .abu', async () => {
    expect(await isMemoryPath('/Users/testuser/.abu/agents/abu/memory.md')).toBe(false);
  });

  it('rejects paths outside .abu', async () => {
    expect(await isMemoryPath('/Users/testuser/Documents/memory/test.md')).toBe(false);
  });

  it('rejects project path without memory segment', async () => {
    expect(await isMemoryPath('/Users/testuser/.abu/projects/some-key/skills/test.md')).toBe(false);
  });
});
