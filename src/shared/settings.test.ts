import { describe, expect, it } from 'vitest';
import { normalizeSettings, parseSettingsPatch } from './settings';

describe('normalizeSettings', () => {
  it.each([undefined, null, 42, 'dark', [], true])('falls back to defaults for %j', (input) => {
    expect(normalizeSettings(input)).toEqual({ theme: 'system', zoom: 1 });
  });

  it('keeps valid values', () => {
    expect(normalizeSettings({ theme: 'dark', zoom: 1.5 })).toEqual({ theme: 'dark', zoom: 1.5 });
  });

  it('replaces each invalid field independently', () => {
    expect(normalizeSettings({ theme: 'neon', zoom: 2 })).toEqual({ theme: 'system', zoom: 2 });
    expect(normalizeSettings({ theme: 'light', zoom: 'big' })).toEqual({ theme: 'light', zoom: 1 });
  });

  it('clamps zoom into the supported range', () => {
    expect(normalizeSettings({ zoom: 99 }).zoom).toBe(3);
    expect(normalizeSettings({ zoom: 0.01 }).zoom).toBe(0.5);
  });

  it('drops unknown keys', () => {
    expect(normalizeSettings({ theme: 'dark', zoom: 1, extra: '<script>' })).toEqual({
      theme: 'dark',
      zoom: 1,
    });
  });

  it('returns a fresh object every time so callers can mutate it safely', () => {
    const first = normalizeSettings(null);
    first.theme = 'dark';
    expect(normalizeSettings(null).theme).toBe('system');
  });
});

describe('parseSettingsPatch', () => {
  it('accepts a partial update', () => {
    expect(parseSettingsPatch({ theme: 'light' })).toEqual({ theme: 'light' });
    expect(parseSettingsPatch({ zoom: 1.25 })).toEqual({ zoom: 1.25 });
    expect(parseSettingsPatch({ theme: 'dark', zoom: 0.8 })).toEqual({ theme: 'dark', zoom: 0.8 });
  });

  it('accepts an empty patch', () => {
    expect(parseSettingsPatch({})).toEqual({});
  });

  it('clamps an out-of-range zoom instead of storing it', () => {
    expect(parseSettingsPatch({ zoom: 50 })).toEqual({ zoom: 3 });
  });

  it.each([
    ['a string', 'dark'],
    ['an array', [{ theme: 'dark' }]],
    ['null', null],
    ['an unknown theme', { theme: 'neon' }],
    ['a non-numeric zoom', { zoom: '1.5' }],
    ['a NaN zoom', { zoom: Number.NaN }],
    ['an infinite zoom', { zoom: Number.POSITIVE_INFINITY }],
    ['an unknown key', { theme: 'dark', evil: 1 }],
  ])('rejects %s', (_label, input) => {
    expect(parseSettingsPatch(input)).toBeNull();
  });
});
