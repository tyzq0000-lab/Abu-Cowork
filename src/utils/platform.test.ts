import { describe, it, expect, afterEach } from 'vitest';
import { isWindows, isMacOS, getPlatform, getShell } from './platform';
import { setPlatformForTest } from '../test/helpers';

describe('platform', () => {
  let cleanup: () => void;
  afterEach(() => cleanup?.());

  describe('isWindows', () => {
    it('returns true when platform is windows', () => {
      cleanup = setPlatformForTest('windows');
      expect(isWindows()).toBe(true);
    });

    it('returns false when platform is macos', () => {
      cleanup = setPlatformForTest('macos');
      expect(isWindows()).toBe(false);
    });

    it('returns false when platform is linux', () => {
      cleanup = setPlatformForTest('linux');
      expect(isWindows()).toBe(false);
    });
  });

  describe('isMacOS', () => {
    it('returns true when platform is macos', () => {
      cleanup = setPlatformForTest('macos');
      expect(isMacOS()).toBe(true);
    });

    it('returns false when platform is windows', () => {
      cleanup = setPlatformForTest('windows');
      expect(isMacOS()).toBe(false);
    });
  });

  describe('getPlatform', () => {
    it('returns "windows" when set', () => {
      cleanup = setPlatformForTest('windows');
      expect(getPlatform()).toBe('windows');
    });

    it('returns "macos" when set', () => {
      cleanup = setPlatformForTest('macos');
      expect(getPlatform()).toBe('macos');
    });

    it('returns "linux" when set', () => {
      cleanup = setPlatformForTest('linux');
      expect(getPlatform()).toBe('linux');
    });
  });

  describe('getShell', () => {
    // getShell() reads internal `cached` var directly — can't override via spy.
    // We can only test the non-Windows path in a macOS test environment.
    it('returns zsh/bash when not on Windows', () => {
      // Test env defaults to macOS mock — getShell reads cached='macos'
      expect(getShell()).toBe('zsh/bash');
    });
  });
});
