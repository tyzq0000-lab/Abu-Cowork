import { describe, it, expect } from 'vitest';
import { isReadOnlyCommand } from './readOnlyDetector';

describe('readOnlyDetector', () => {
  describe('read-only commands', () => {
    const readOnlyCases = [
      'ls -la',
      'cat file.txt',
      'head -20 file.txt',
      'tail -f log.txt',
      'grep -r "pattern" src/',
      'rg "pattern" --type ts',
      'find . -name "*.ts"',
      'wc -l file.txt',
      'which node',
      'echo hello',
      'pwd',
      'date',
      'whoami',
      'uname -a',
      'env',
      'printenv HOME',
      'node --version',
      'npm --version',
      'python3 --version',
      'git status',
      'git log --oneline -10',
      'git diff HEAD',
      'git branch -a',
      'git remote -v',
      'git rev-parse HEAD',
      'npm list --depth=0',
      'npm outdated',
      'npm audit',
      'sort file.txt',
      'jq ".name" package.json',
      'tree -L 2',
      'df -h',
      'du -sh .',
      'stat file.txt',
      '',  // empty command
    ];

    for (const cmd of readOnlyCases) {
      it(`"${cmd}" → read-only`, () => {
        expect(isReadOnlyCommand(cmd)).toBe(true);
      });
    }
  });

  describe('piped read-only commands', () => {
    it('grep | sort → read-only', () => {
      expect(isReadOnlyCommand('grep pattern file | sort | uniq')).toBe(true);
    });

    it('cat | head → read-only', () => {
      expect(isReadOnlyCommand('cat file.txt | head -20')).toBe(true);
    });

    it('git log | grep → read-only', () => {
      expect(isReadOnlyCommand('git log --oneline | grep fix')).toBe(true);
    });
  });

  describe('chained read-only commands', () => {
    it('ls && pwd → read-only', () => {
      expect(isReadOnlyCommand('ls && pwd')).toBe(true);
    });

    it('echo hello; date → read-only', () => {
      expect(isReadOnlyCommand('echo hello; date')).toBe(true);
    });
  });

  describe('write commands', () => {
    const writeCases = [
      'rm file.txt',
      'mkdir new-dir',
      'touch file.txt',
      'mv a.txt b.txt',
      'cp a.txt b.txt',
      'chmod 755 script.sh',
      'sudo apt update',
      'npm install lodash',
      'pip install requests',
      'git push origin main',
      'git commit -m "msg"',
      'git add .',
      'kill -9 1234',
    ];

    for (const cmd of writeCases) {
      it(`"${cmd}" → NOT read-only`, () => {
        expect(isReadOnlyCommand(cmd)).toBe(false);
      });
    }
  });

  describe('output redirection', () => {
    it('echo hello > file → NOT read-only', () => {
      expect(isReadOnlyCommand('echo hello > file.txt')).toBe(false);
    });

    it('cat file >> log → NOT read-only', () => {
      expect(isReadOnlyCommand('cat file.txt >> log.txt')).toBe(false);
    });

    it('grep pattern 2>&1 → read-only (stderr redirect is ok)', () => {
      // This is a known limitation — we're conservative with redirects
      // The regex `(?<![2&])>` tries to exclude 2>&1 but may be imperfect
      expect(isReadOnlyCommand('grep pattern file 2>&1')).toBe(true);
    });
  });

  describe('subshell / command substitution', () => {
    it('echo $(rm file) → NOT read-only', () => {
      expect(isReadOnlyCommand('echo $(rm file)')).toBe(false);
    });

    it('echo `whoami` → NOT read-only (conservative)', () => {
      expect(isReadOnlyCommand('echo `whoami`')).toBe(false);
    });
  });

  describe('mixed chains', () => {
    it('ls && rm file → NOT read-only', () => {
      expect(isReadOnlyCommand('ls && rm file.txt')).toBe(false);
    });

    it('grep | tee output → NOT read-only', () => {
      expect(isReadOnlyCommand('grep pattern file | tee output.txt')).toBe(false);
    });
  });

  describe('find with -delete', () => {
    it('find . -name "*.tmp" -delete → NOT read-only', () => {
      expect(isReadOnlyCommand('find . -name "*.tmp" -delete')).toBe(false);
    });

    it('find . -name "*.ts" → read-only', () => {
      expect(isReadOnlyCommand('find . -name "*.ts"')).toBe(true);
    });
  });
});
