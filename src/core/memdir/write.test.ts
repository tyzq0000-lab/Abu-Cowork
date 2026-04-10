import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readTextFile, writeTextFile, exists, remove, readDir } from '@tauri-apps/plugin-fs';
import { writeMemory, deleteMemory, clearAllMemories, touchMemory } from './write';
import { _resetCachedHome } from './paths';

const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockExists = vi.mocked(exists);
const mockRemove = vi.mocked(remove);
const mockReadDir = vi.mocked(readDir);

beforeEach(() => {
  vi.clearAllMocks();
  _resetCachedHome();
  // Default: directory exists but is empty, no existing index
  mockReadDir.mockResolvedValue([]);
  mockReadTextFile.mockRejectedValue(new Error('not found'));
  mockExists.mockResolvedValue(false);
});

describe('writeMemory', () => {
  it('writes a .md file with frontmatter and updates index', async () => {
    const filename = await writeMemory({
      name: 'Test memory',
      description: 'A test',
      type: 'feedback',
      content: 'Remember this.',
      source: 'agent_explicit',
      workspacePath: null,
    });

    expect(filename).toMatch(/^feedback_test_memory\.md$/);

    // Should have written the .md file
    const writeCalls = mockWriteTextFile.mock.calls;
    expect(writeCalls.length).toBeGreaterThanOrEqual(2); // file + index

    // Check file content has frontmatter
    const fileCall = writeCalls.find(c => (c[0] as string).includes('feedback_'));
    expect(fileCall).toBeDefined();
    const fileContent = fileCall![1] as string;
    expect(fileContent).toContain('---');
    expect(fileContent).toContain('name: Test memory');
    expect(fileContent).toContain('type: feedback');
    expect(fileContent).toContain('Remember this.');

    // Check index was updated
    const indexCall = writeCalls.find(c => (c[0] as string).includes('MEMORY.md'));
    expect(indexCall).toBeDefined();
    const indexContent = indexCall![1] as string;
    expect(indexContent).toContain('feedback_test_memory.md');
  });

  it('uses workspace path when provided', async () => {
    await writeMemory({
      name: 'Project note',
      description: 'Project specific',
      type: 'project',
      content: 'Project info.',
      workspacePath: '/workspace/myapp',
    });

    const writeCalls = mockWriteTextFile.mock.calls;
    const fileCall = writeCalls.find(c => (c[0] as string).includes('project_'));
    expect(fileCall).toBeDefined();
    // Path should go through projects/<sanitized>/memory/
    expect((fileCall![0] as string)).toContain('/projects/');
    expect((fileCall![0] as string)).toContain('/memory/');
  });

  it('generates filename from type and name', async () => {
    const filename = await writeMemory({
      name: '用户偏好设置',
      description: 'desc',
      type: 'user',
      content: 'content',
    });
    expect(filename).toMatch(/^user_用户偏好设置\.md$/);
  });
});

describe('touchMemory', () => {
  it('increments accessCount and updates timestamp', async () => {
    const original = `---
name: Test
accessCount: 5
updated: 1000
---

Content`;
    mockReadTextFile.mockResolvedValueOnce(original);

    await touchMemory('/mock/test.md');

    expect(mockWriteTextFile).toHaveBeenCalledOnce();
    const written = mockWriteTextFile.mock.calls[0][1] as string;
    expect(written).toContain('accessCount: 6');
    expect(written).not.toContain('updated: 1000');
  });

  it('silently handles missing files', async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error('not found'));
    await expect(touchMemory('/mock/missing.md')).resolves.toBeUndefined();
  });
});

describe('deleteMemory', () => {
  it('removes file and updates index', async () => {
    mockExists.mockResolvedValueOnce(true);
    mockReadTextFile.mockResolvedValueOnce('# Memory Index\n- [test.md](test.md) — desc\n- [other.md](other.md) — other');

    await deleteMemory('test.md', null);

    expect(mockRemove).toHaveBeenCalledOnce();
    expect(mockWriteTextFile).toHaveBeenCalledOnce();
    const indexContent = mockWriteTextFile.mock.calls[0][1] as string;
    expect(indexContent).not.toContain('test.md');
    expect(indexContent).toContain('other.md');
  });

  it('handles already-deleted file gracefully', async () => {
    mockExists.mockResolvedValueOnce(false);
    mockReadTextFile.mockRejectedValueOnce(new Error('not found'));
    await expect(deleteMemory('missing.md', null)).resolves.toBeUndefined();
  });
});

describe('clearAllMemories', () => {
  it('deletes all .md files and resets index', async () => {
    mockReadDir.mockResolvedValueOnce([
      { name: 'a.md', isDirectory: false, isFile: true, isSymlink: false },
      { name: 'b.md', isDirectory: false, isFile: true, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>);
    // scanMemoryFiles reads each file for frontmatter
    mockReadTextFile
      .mockResolvedValueOnce('---\nname: A\ntype: user\n---\ncontent')
      .mockResolvedValueOnce('---\nname: B\ntype: project\n---\ncontent');

    const count = await clearAllMemories(null);
    expect(count).toBe(2);
    expect(mockRemove).toHaveBeenCalledTimes(2);
    // Index should be reset
    const indexCall = mockWriteTextFile.mock.calls.find(c => (c[0] as string).includes('MEMORY.md'));
    expect(indexCall).toBeDefined();
    expect(indexCall![1]).toBe('# Memory Index\n');
  });
});
