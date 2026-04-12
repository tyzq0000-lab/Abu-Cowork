import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { extractOfficeText, listArchiveContents } from './toolHelpers';

// Regression coverage for the shell-injection fixes in:
//   - extractPptxViaPython (toolHelpers.ts) — Python -c path
//   - listArchiveContents  (toolHelpers.ts) — unzip/tar/file on Unix
//
// All four sites used to interpolate a user-controlled filePath into a
// double-quoted shell command string, which zsh/bash happily parsed as
// multiple commands if the path contained `"`, `$(...)`, or `` `...` ``.
// After the fix, each site dispatches to `run_argv_command` with the
// filePath as a standalone argv element. These tests enforce the contract.

const EVIL_PPTX = '/tmp/x$(touch /tmp/ABU_PWN)y.pptx';
const EVIL_ZIP = '/tmp/x"; touch /tmp/ABU_PWN; y=".zip';
const EVIL_TAR = '/tmp/x"; touch /tmp/ABU_PWN; y=".tar';
const EVIL_TARGZ = '/tmp/x"; touch /tmp/ABU_PWN; y=".tar.gz';
const EVIL_GZ = '/tmp/x"; touch /tmp/ABU_PWN; y=".gz';

type InvokePayload = { program: string; args: string[]; timeout?: number };

function firstCall() {
  return vi.mocked(invoke).mock.calls[0] as unknown as [string, InvokePayload];
}

describe('extractOfficeText(.pptx) — shell injection regression', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('dispatches run_argv_command with file path as sys.argv[1], not interpolated', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      code: 0,
      stdout: '=== Slide 1 ===\nhello',
      stderr: '',
    });

    const result = await extractOfficeText(EVIL_PPTX, '.pptx');
    expect(result).toBe('=== Slide 1 ===\nhello');

    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmdName, payload] = firstCall();
    expect(cmdName).toBe('run_argv_command');
    expect(payload.program).toBe('python3');
    expect(payload.args[0]).toBe('-c');
    // The Python source must NOT contain the evil path (no interpolation)
    expect(payload.args[1]).not.toContain(EVIL_PPTX);
    expect(payload.args[1]).not.toContain('$(');
    expect(payload.args[1]).toContain('sys.argv[1]');
    // File path is passed as the third argv element — argv[1] for Python
    expect(payload.args[2]).toBe(EVIL_PPTX);
  });

  it('never dispatches run_shell_command for pptx', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ code: 0, stdout: 'x', stderr: '' });
    await extractOfficeText(EVIL_PPTX, '.pptx');

    const shellCalls = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === 'run_shell_command');
    expect(shellCalls).toHaveLength(0);
  });
});

describe('listArchiveContents — shell injection regression', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('.zip uses unzip -l with file path as argv element (Unix)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      code: 0,
      stdout: 'Archive listing...',
      stderr: '',
    });

    await listArchiveContents(EVIL_ZIP, '.zip');

    const [cmdName, payload] = firstCall();
    expect(cmdName).toBe('run_argv_command');
    expect(payload.program).toBe('unzip');
    expect(payload.args).toEqual(['-l', EVIL_ZIP]);
  });

  it('.tar uses tar -tf with file path as argv element', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      code: 0,
      stdout: 'entry1\nentry2',
      stderr: '',
    });

    await listArchiveContents(EVIL_TAR, '.tar');

    const [cmdName, payload] = firstCall();
    expect(cmdName).toBe('run_argv_command');
    expect(payload.program).toBe('tar');
    expect(payload.args).toEqual(['-tf', EVIL_TAR]);
  });

  it('.tar.gz uses tar -tf with file path as argv element', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      code: 0,
      stdout: 'entry1',
      stderr: '',
    });

    await listArchiveContents(EVIL_TARGZ, '.tar.gz');

    const [cmdName, payload] = firstCall();
    expect(cmdName).toBe('run_argv_command');
    expect(payload.program).toBe('tar');
    expect(payload.args).toEqual(['-tf', EVIL_TARGZ]);
  });

  it('.gz (non-tar) uses file with file path as sole argv element', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      code: 0,
      stdout: 'gzip compressed data',
      stderr: '',
    });

    await listArchiveContents(EVIL_GZ, '.gz');

    const [cmdName, payload] = firstCall();
    expect(cmdName).toBe('run_argv_command');
    expect(payload.program).toBe('file');
    expect(payload.args).toEqual([EVIL_GZ]);
  });

  it('never dispatches run_shell_command for Unix archive paths', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });
    await listArchiveContents('/tmp/benign.zip', '.zip');

    const shellCalls = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === 'run_shell_command');
    expect(shellCalls).toHaveLength(0);
  });
});
