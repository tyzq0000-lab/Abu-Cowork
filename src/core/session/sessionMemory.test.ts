import { describe, it, expect } from 'vitest';
import {
  shouldOffload,
  isDiskRef,
  extractRefId,
  createDiskRef,
  DISK_REF_PREFIX,
  DISK_REF_SUFFIX,
} from './sessionMemory';

describe('sessionMemory', () => {
  describe('shouldOffload', () => {
    it('returns false for small results', () => {
      expect(shouldOffload('hello')).toBe(false);
      expect(shouldOffload('x'.repeat(8192))).toBe(false);
    });

    it('returns true for large results', () => {
      expect(shouldOffload('x'.repeat(8193))).toBe(true);
      expect(shouldOffload('x'.repeat(50000))).toBe(true);
    });
  });

  describe('isDiskRef', () => {
    it('recognizes valid disk references', () => {
      const ref = `${DISK_REF_PREFIX}abc123${DISK_REF_SUFFIX}\npreview content`;
      expect(isDiskRef(ref)).toBe(true);
    });

    it('rejects non-references', () => {
      expect(isDiskRef('normal result')).toBe(false);
      expect(isDiskRef(`${DISK_REF_PREFIX}incomplete`)).toBe(false);
    });
  });

  describe('extractRefId', () => {
    it('extracts ID from valid reference', () => {
      const ref = `${DISK_REF_PREFIX}tc_12345${DISK_REF_SUFFIX}\nsome preview`;
      expect(extractRefId(ref)).toBe('tc_12345');
    });

    it('returns null for non-references', () => {
      expect(extractRefId('not a reference')).toBeNull();
    });
  });

  describe('createDiskRef', () => {
    it('creates reference with preview', () => {
      const result = 'a'.repeat(1000);
      const ref = createDiskRef('tc_001', result);
      expect(isDiskRef(ref)).toBe(true);
      expect(extractRefId(ref)).toBe('tc_001');
      expect(ref.length).toBeLessThan(result.length);
    });

    it('includes full output size in reference', () => {
      const result = 'a'.repeat(10000);
      const ref = createDiskRef('tc_size', result);
      expect(ref).toContain('Full output: 10000 chars');
      expect(ref).toContain('showing first 500 chars');
    });

    it('shows actual length when content is shorter than preview limit', () => {
      const ref = createDiskRef('tc_short', 'short');
      expect(ref).toContain('Full output: 5 chars');
      expect(ref).toContain('showing first 5 chars');
      expect(ref).not.toContain('...');
    });

    it('truncates long content with ellipsis', () => {
      const longContent = 'x'.repeat(600);
      const ref = createDiskRef('tc_003', longContent);
      expect(ref).toContain('...');
      expect(ref).toContain('Full output: 600 chars');
    });
  });
});
