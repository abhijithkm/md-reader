import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ] as const)(
    '%s preference while the system prefers dark=%s -> %s',
    (preference, dark, expected) => {
      expect(resolveTheme(preference, dark)).toBe(expected);
    },
  );
});
