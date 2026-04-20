import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { packSkill, validateArchive, unpackSkill, ConflictError } from './packager';

// ── Helpers ──────────────────────────────────────────────────

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill
---

Hello world`;

const SKILL_MD_NO_NAME = `---
description: missing name
---

Content`;

function makeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = strToU8(content);
  }
  return zipSync(entries, { level: 0 });
}

// ── Mock Tauri fs (hoisted so vi.mock factory can reference them) ──

interface DirEntry { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }

const { mockExists, mockMkdir, mockWriteFile, mockReadDir, mockReadFile } = vi.hoisted(() => ({
  mockExists: vi.fn<(path: string) => Promise<boolean>>(),
  mockMkdir: vi.fn<(path: string, opts?: object) => Promise<void>>(),
  mockWriteFile: vi.fn<(path: string, data: Uint8Array) => Promise<void>>(),
  mockReadDir: vi.fn<(path: string) => Promise<DirEntry[]>>(),
  mockReadFile: vi.fn<(path: string) => Promise<Uint8Array>>(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile.mockResolvedValue(undefined),
  readDir: mockReadDir,
  readTextFile: vi.fn().mockResolvedValue(''),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: mockExists,
  mkdir: mockMkdir.mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  watch: vi.fn().mockResolvedValue(() => {}),
  BaseDirectory: { AppData: 0, Home: 1 },
}));

/**
 * Install a fake fs tree. `tree` maps absolute paths → entry list (for dirs) or file content (for files).
 * Dir listing: keys ending with "/". File read: any other key.
 */
function installFakeFs(tree: Record<string, DirEntry[] | string>) {
  mockReadDir.mockImplementation(async (path: string) => {
    const key = path.endsWith('/.') ? path.slice(0, -2) : path;
    const entries = tree[key];
    if (!Array.isArray(entries)) throw new Error(`readDir: no entry for ${key}`);
    return entries;
  });
  mockReadFile.mockImplementation(async (path: string) => {
    const content = tree[path];
    if (typeof content !== 'string') throw new Error(`readFile: no entry for ${path}`);
    return strToU8(content);
  });
}

function file(name: string): DirEntry {
  return { name, isDirectory: false, isFile: true, isSymlink: false };
}
function dir(name: string): DirEntry {
  return { name, isDirectory: true, isFile: false, isSymlink: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(false);
});

// ── validateArchive ──────────────────────────────────────────

describe('validateArchive', () => {
  it('returns null for a valid archive', () => {
    const zip = makeZip({ 'SKILL.md': VALID_SKILL_MD });
    expect(validateArchive(zip)).toBeNull();
  });

  it('rejects archive without SKILL.md', () => {
    const zip = makeZip({ 'README.md': '# Hello' });
    const err = validateArchive(zip);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('NO_SKILL_MD');
  });

  it('rejects archive with SKILL.md missing name field', () => {
    const zip = makeZip({ 'SKILL.md': SKILL_MD_NO_NAME });
    const err = validateArchive(zip);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('NO_NAME');
  });

  it('rejects archive with path traversal', () => {
    const zip = makeZip({
      'SKILL.md': VALID_SKILL_MD,
      '../etc/passwd': 'bad',
    });
    const err = validateArchive(zip);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects archive with absolute paths', () => {
    const zip = makeZip({
      'SKILL.md': VALID_SKILL_MD,
      '/etc/passwd': 'bad',
    });
    const err = validateArchive(zip);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects non-zip data', () => {
    const err = validateArchive(new Uint8Array([1, 2, 3]));
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_ZIP');
  });

  it('rejects archive exceeding size limit', () => {
    // 51 MB of zeros
    const huge = new Uint8Array(51 * 1024 * 1024);
    const err = validateArchive(huge);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('ARCHIVE_TOO_LARGE');
  });

  it('accepts SKILL.md in a subdirectory', () => {
    const zip = makeZip({ 'my-skill/SKILL.md': VALID_SKILL_MD });
    expect(validateArchive(zip)).toBeNull();
  });

  it('rejects file exceeding per-file size limit', () => {
    // Create a zip with a file > 10MB
    const bigContent = 'x'.repeat(11 * 1024 * 1024);
    const zip = makeZip({
      'SKILL.md': VALID_SKILL_MD,
      'scripts/big.bin': bigContent,
    });
    const err = validateArchive(zip);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('FILE_TOO_LARGE');
  });
});

// ── unpackSkill ──────────────────────────────────────────────

describe('unpackSkill', () => {
  it('unpacks files to correct directory', async () => {
    const zip = makeZip({
      'SKILL.md': VALID_SKILL_MD,
      'scripts/run.py': 'print("hello")',
    });

    const result = await unpackSkill(zip, '/home/.abu/skills');

    expect(result.name).toBe('test-skill');
    expect(result.targetDir).toBe('/home/.abu/skills/test-skill');
    expect(result.files).toContain('SKILL.md');
    expect(result.files).toContain('scripts/run.py');

    // Verify mkdir was called for parent dirs
    expect(mockMkdir).toHaveBeenCalled();
    // Verify writeFile was called for each file
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });

  it('strips subdirectory prefix when SKILL.md is nested', async () => {
    const zip = makeZip({
      'my-skill/SKILL.md': VALID_SKILL_MD,
      'my-skill/assets/logo.png': 'PNG_DATA',
    });

    const result = await unpackSkill(zip, '/home/.abu/skills');

    expect(result.name).toBe('test-skill');
    expect(result.files).toContain('SKILL.md');
    expect(result.files).toContain('assets/logo.png');
  });

  it('throws ConflictError when skill already exists', async () => {
    mockExists.mockResolvedValue(true);

    const zip = makeZip({ 'SKILL.md': VALID_SKILL_MD });

    await expect(unpackSkill(zip, '/home/.abu/skills')).rejects.toThrow(ConflictError);
  });

  it('overwrites when overwrite option is set', async () => {
    mockExists.mockResolvedValue(true);

    const zip = makeZip({ 'SKILL.md': VALID_SKILL_MD });
    const result = await unpackSkill(zip, '/home/.abu/skills', { overwrite: true });

    expect(result.name).toBe('test-skill');
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('skips dotfiles from archives produced by older/external packagers', async () => {
    // Defensive: if an archive contains .DS_Store or .gitignore, those entries
    // would fail Tauri fs scope on writeFile. The unpacker must filter them.
    const zip = makeZip({
      'SKILL.md': VALID_SKILL_MD,
      '.DS_Store': 'junk',
      '.gitignore': 'node_modules',
      'scripts/run.py': 'print("hi")',
      '.git/HEAD': 'ref: refs/heads/main',
      'node_modules/pkg/index.js': 'module.exports = {}',
    });

    const result = await unpackSkill(zip, '/home/.abu/skills');

    expect(result.files).toContain('SKILL.md');
    expect(result.files).toContain('scripts/run.py');
    expect(result.files).not.toContain('.DS_Store');
    expect(result.files).not.toContain('.gitignore');
    expect(result.files).not.toContain('.git/HEAD');
    expect(result.files).not.toContain('node_modules/pkg/index.js');
  });
});

// ── packSkill ────────────────────────────────────────────────

describe('packSkill', () => {
  it('skips .DS_Store, .gitignore, and other dotfiles', async () => {
    const root = '/home/.abu/skills/test-skill';
    installFakeFs({
      [root]: [file('SKILL.md'), file('.DS_Store'), file('.gitignore'), dir('scripts')],
      [`${root}/scripts`]: [file('run.py')],
      [`${root}/SKILL.md`]: VALID_SKILL_MD,
      [`${root}/.DS_Store`]: 'macos noise',
      [`${root}/.gitignore`]: 'node_modules',
      [`${root}/scripts/run.py`]: 'print("hi")',
    });

    const bytes = await packSkill(root);
    const entries = unzipSync(bytes);

    expect(Object.keys(entries)).toContain('SKILL.md');
    expect(Object.keys(entries)).toContain('scripts/run.py');
    expect(Object.keys(entries)).not.toContain('.DS_Store');
    expect(Object.keys(entries)).not.toContain('.gitignore');
  });

  it('skips .git/ and node_modules/ directory trees (never recurses into them)', async () => {
    const root = '/home/.abu/skills/test-skill';
    installFakeFs({
      [root]: [file('SKILL.md'), dir('.git'), dir('node_modules')],
      [`${root}/SKILL.md`]: VALID_SKILL_MD,
      // Intentionally no entry for the excluded subdirs — if packSkill
      // recurses into them, readDir will throw and the test fails.
    });

    const bytes = await packSkill(root);
    const entries = unzipSync(bytes);

    expect(Object.keys(entries)).toEqual(['SKILL.md']);
  });

  it('keeps Thumbs.db out of the archive', async () => {
    const root = '/home/.abu/skills/test-skill';
    installFakeFs({
      [root]: [file('SKILL.md'), file('Thumbs.db')],
      [`${root}/SKILL.md`]: VALID_SKILL_MD,
      [`${root}/Thumbs.db`]: 'windows noise',
    });

    const bytes = await packSkill(root);
    const entries = unzipSync(bytes);

    expect(Object.keys(entries)).not.toContain('Thumbs.db');
  });
});

// ── ConflictError ────────────────────────────────────────────

describe('ConflictError', () => {
  it('has correct properties', () => {
    const err = new ConflictError('my-skill', '/path/to/my-skill');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConflictError');
    expect(err.skillName).toBe('my-skill');
    expect(err.targetDir).toBe('/path/to/my-skill');
    expect(err.message).toContain('my-skill');
  });
});
