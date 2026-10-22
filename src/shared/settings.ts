import { clampZoom, DEFAULT_ZOOM } from './zoom';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  zoom: number;
}

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const DEFAULT_SETTINGS: Readonly<Settings> = { theme: 'system', zoom: DEFAULT_ZOOM };

const PATCH_KEYS: ReadonlySet<string> = new Set(['theme', 'zoom']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTheme(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Tolerant parser for data read from disk: anything unusable falls back to the
 * default for that field so a damaged settings file never blocks startup.
 */
export function normalizeSettings(input: unknown): Settings {
  const source = isRecord(input) ? input : {};
  return {
    theme: isTheme(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    zoom: isFiniteNumber(source.zoom) ? clampZoom(source.zoom) : DEFAULT_SETTINGS.zoom,
  };
}

/**
 * Strict parser for updates arriving over IPC: unknown keys or wrong types
 * reject the whole patch. Out-of-range zoom is clamped rather than stored.
 */
export function parseSettingsPatch(input: unknown): Partial<Settings> | null {
  if (!isRecord(input)) return null;
  if (Object.keys(input).some((key) => !PATCH_KEYS.has(key))) return null;

  const patch: Partial<Settings> = {};
  if ('theme' in input) {
    if (!isTheme(input.theme)) return null;
    patch.theme = input.theme;
  }
  if ('zoom' in input) {
    if (!isFiniteNumber(input.zoom)) return null;
    patch.zoom = clampZoom(input.zoom);
  }
  return patch;
}
