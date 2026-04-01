import { describe, it, expect } from 'vitest';
import { mergeSections, sectionsToString, type PromptSection } from './promptSections';

describe('promptSections', () => {
  describe('mergeSections', () => {
    it('returns empty array for empty input', () => {
      expect(mergeSections([])).toEqual([]);
    });

    it('merges adjacent sections with same cacheability', () => {
      const sections: PromptSection[] = [
        { name: 'a', text: 'hello', cacheable: true },
        { name: 'b', text: 'world', cacheable: true },
        { name: 'c', text: 'dynamic', cacheable: false },
      ];
      const merged = mergeSections(sections);
      expect(merged).toHaveLength(2);
      expect(merged[0].text).toBe('hello\n\nworld');
      expect(merged[0].cacheable).toBe(true);
      expect(merged[0].name).toBe('a+b');
      expect(merged[1].text).toBe('dynamic');
      expect(merged[1].cacheable).toBe(false);
    });

    it('preserves sections with alternating cacheability', () => {
      const sections: PromptSection[] = [
        { name: 'a', text: 'static1', cacheable: true },
        { name: 'b', text: 'dynamic1', cacheable: false },
        { name: 'c', text: 'static2', cacheable: true },
      ];
      const merged = mergeSections(sections);
      expect(merged).toHaveLength(3);
      expect(merged.map(s => s.cacheable)).toEqual([true, false, true]);
    });

    it('handles single section', () => {
      const sections: PromptSection[] = [
        { name: 'only', text: 'content', cacheable: true },
      ];
      const merged = mergeSections(sections);
      expect(merged).toHaveLength(1);
      expect(merged[0].text).toBe('content');
    });

    it('merges all volatile sections together', () => {
      const sections: PromptSection[] = [
        { name: 'a', text: '1', cacheable: false },
        { name: 'b', text: '2', cacheable: false },
        { name: 'c', text: '3', cacheable: false },
      ];
      const merged = mergeSections(sections);
      expect(merged).toHaveLength(1);
      expect(merged[0].text).toBe('1\n\n2\n\n3');
      expect(merged[0].cacheable).toBe(false);
    });
  });

  describe('sectionsToString', () => {
    it('joins all sections with double newline', () => {
      const sections: PromptSection[] = [
        { name: 'a', text: 'hello', cacheable: true },
        { name: 'b', text: 'world', cacheable: false },
      ];
      expect(sectionsToString(sections)).toBe('hello\n\nworld');
    });

    it('returns empty string for empty input', () => {
      expect(sectionsToString([])).toBe('');
    });
  });
});
