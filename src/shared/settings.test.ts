import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, parseSettingsPatch } from './settings';

const DEFAULTS = { theme: 'system', zoom: 1, automaticUpdates: true, updateNoticeSeen: false };

describe('normalizeSettings', () => {
  it.each([undefined, null, 42, 'dark', [], true])('falls back to defaults for %j', (input) => {
    expect(normalizeSettings(input)).toEqual(DEFAULTS);
  });

  it('keeps valid values', () => {
    expect(normalizeSettings({ theme: 'dark', zoom: 1.5 })).toEqual({
      ...DEFAULTS,
      theme: 'dark',
      zoom: 1.5,
    });
  });

  it('replaces each invalid field independently', () => {
    expect(normalizeSettings({ theme: 'neon', zoom: 2 })).toEqual({ ...DEFAULTS, zoom: 2 });
    expect(normalizeSettings({ theme: 'light', zoom: 'big' })).toEqual({
      ...DEFAULTS,
      theme: 'light',
    });
  });

  it('clamps zoom into the supported range', () => {
    expect(normalizeSettings({ zoom: 99 }).zoom).toBe(3);
    expect(normalizeSettings({ zoom: 0.01 }).zoom).toBe(0.5);
  });

  it('drops unknown keys', () => {
    expect(normalizeSettings({ theme: 'dark', zoom: 1, extra: '<script>' })).toEqual({
      ...DEFAULTS,
      theme: 'dark',
    });
  });

  it('returns a fresh object every time so callers can mutate it safely', () => {
    const first = normalizeSettings(null);
    first.theme = 'dark';
    expect(normalizeSettings(null).theme).toBe('system');
  });

  describe('automatic updates', () => {
    it('are on, and not yet explained, by default', () => {
      expect(DEFAULT_SETTINGS.automaticUpdates).toBe(true);
      expect(DEFAULT_SETTINGS.updateNoticeSeen).toBe(false);
    });

    it('keeps the two switches when they are valid', () => {
      expect(normalizeSettings({ automaticUpdates: false, updateNoticeSeen: true })).toEqual({
        ...DEFAULTS,
        automaticUpdates: false,
        updateNoticeSeen: true,
      });
    });

    it('replaces a switch that is not a boolean with its default', () => {
      expect(normalizeSettings({ automaticUpdates: 'no', updateNoticeSeen: 1 })).toEqual(DEFAULTS);
      expect(normalizeSettings({ automaticUpdates: null, updateNoticeSeen: [] })).toEqual(DEFAULTS);
    });

    it('reads a file written by version 1.0.0, which only knew theme and zoom', () => {
      expect(normalizeSettings({ theme: 'dark', zoom: 2 })).toEqual({
        theme: 'dark',
        zoom: 2,
        automaticUpdates: true,
        updateNoticeSeen: false,
      });
    });
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

  it('accepts the update switches', () => {
    expect(parseSettingsPatch({ automaticUpdates: false })).toEqual({ automaticUpdates: false });
    expect(parseSettingsPatch({ updateNoticeSeen: true })).toEqual({ updateNoticeSeen: true });
    expect(parseSettingsPatch({ automaticUpdates: false, updateNoticeSeen: true })).toEqual({
      automaticUpdates: false,
      updateNoticeSeen: true,
    });
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
    ['a text instead of the updates switch', { automaticUpdates: 'yes' }],
    ['a number instead of the updates switch', { automaticUpdates: 1 }],
    ['a null instead of the notice switch', { updateNoticeSeen: null }],
    ['a text instead of the notice switch', { updateNoticeSeen: 'true' }],
  ])('rejects %s', (_label, input) => {
    expect(parseSettingsPatch(input)).toBeNull();
  });
});
