import { describe, it, expect } from 'vitest';
import { getPermissionStrategy } from './permissionMode';
import type { PermissionMode } from './permissionMode';

describe('permissionMode', () => {
  describe('default mode', () => {
    const strategy = getPermissionStrategy('default');

    it('confirms danger commands', () => {
      expect(strategy.shouldConfirmCommand(
        { command: 'rm -rf /', level: 'danger', reason: 'destructive' },
        false,
      )).toBe(true);
    });

    it('confirms warn commands', () => {
      expect(strategy.shouldConfirmCommand(
        { command: 'npm install', level: 'warn', reason: 'modifying' },
        false,
      )).toBe(true);
    });

    it('does not confirm safe commands', () => {
      expect(strategy.shouldConfirmCommand(
        { command: 'ls', level: 'safe', reason: '' },
        true,
      )).toBe(false);
    });

    it('confirms file access when needsPermission', () => {
      expect(strategy.shouldConfirmFileAccess('read', true)).toBe(true);
      expect(strategy.shouldConfirmFileAccess('write', true)).toBe(true);
    });

    it('does not confirm file access when no permission needed', () => {
      expect(strategy.shouldConfirmFileAccess('read', false)).toBe(false);
    });

    it('does not confirm other tools', () => {
      expect(strategy.shouldConfirmOtherTool()).toBe(false);
    });
  });

  describe('auto mode', () => {
    const strategy = getPermissionStrategy('auto');

    it('skips confirmation for read-only commands even if danger', () => {
      expect(strategy.shouldConfirmCommand(
        { command: 'cat /etc/passwd', level: 'danger', reason: 'sensitive path' },
        true,
      )).toBe(false);
    });

    it('confirms non-read-only dangerous commands', () => {
      expect(strategy.shouldConfirmCommand(
        { command: 'rm -rf /', level: 'danger', reason: 'destructive' },
        false,
      )).toBe(true);
    });

    it('skips confirmation for read file access', () => {
      expect(strategy.shouldConfirmFileAccess('read', true)).toBe(false);
    });

    it('confirms write file access when needs permission', () => {
      expect(strategy.shouldConfirmFileAccess('write', true)).toBe(true);
    });
  });

  describe('strict mode', () => {
    const strategy = getPermissionStrategy('strict');

    it('confirms all commands', () => {
      expect(strategy.shouldConfirmCommand(
        { command: 'ls', level: 'safe', reason: '' },
        true,
      )).toBe(true);
    });

    it('confirms all file access', () => {
      expect(strategy.shouldConfirmFileAccess('read', false)).toBe(true);
      expect(strategy.shouldConfirmFileAccess('write', false)).toBe(true);
    });

    it('confirms other tools', () => {
      expect(strategy.shouldConfirmOtherTool()).toBe(true);
    });
  });

  describe('getPermissionStrategy', () => {
    it('returns default strategy for unknown mode', () => {
      const strategy = getPermissionStrategy('unknown' as PermissionMode);
      // Should behave like default
      expect(strategy.shouldConfirmCommand(
        { command: 'ls', level: 'safe', reason: '' },
        true,
      )).toBe(false);
    });
  });
});
