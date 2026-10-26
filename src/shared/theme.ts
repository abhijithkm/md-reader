import type { ThemePreference } from './settings';

export type ResolvedTheme = 'light' | 'dark';

/**
 * Colour the window shows before the page has painted, so there is no white
 * flash in dark mode. These must stay equal to --surface-document in
 * styles/tokens.css (a test checks it).
 */
export const WINDOW_BACKGROUND: Readonly<Record<ResolvedTheme, string>> = {
  light: '#f9fafb',
  dark: '#0f141a',
};

/** The theme actually shown: an explicit choice wins, "system" follows the OS. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}
