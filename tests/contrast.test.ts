import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOW_BACKGROUND } from '../src/shared/theme';

const tokensCss = readFileSync(
  path.join(process.cwd(), 'src', 'renderer', 'styles', 'tokens.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties declared by the rule whose selector contains `marker`. */
function readTokens(marker: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, selector, body] of tokensCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selector?.includes(marker)) continue;
    for (const [, name, value] of (body ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name !== undefined && value !== undefined) tokens.set(name, value.trim());
    }
  }
  return tokens;
}

function channel(hex: string, index: number): number {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
function contrast(foreground: string, background: string): number {
  const [lighter = 0, darker = 0] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const themes = {
  light: readTokens("[data-theme='light']"),
  dark: readTokens("[data-theme='dark']"),
} as const;

// [foreground, background, minimum ratio]. 4.5 is the WCAG AA level for normal
// text, 3 for icons and focus indicators; body text is held to AAA (7).
const REQUIRED: readonly (readonly [string, string, number])[] = [
  ['--text', '--surface-document', 7],
  ['--text', '--surface-app', 7],
  ['--text', '--surface-code', 7],
  ['--text', '--surface-hover', 4.5],
  ['--text', '--surface-active', 4.5],
  ['--text-muted', '--surface-document', 4.5],
  ['--text-muted', '--surface-app', 4.5],
  ['--text-muted', '--surface-code', 4.5],
  ['--link', '--surface-document', 4.5],
  ['--accent', '--surface-app', 3],
  ['--focus', '--surface-document', 3],
  ['--focus', '--surface-app', 3],
  ['--on-accent-solid', '--accent-solid', 4.5],
  ['--on-accent-solid', '--accent-solid-hover', 4.5],
  ['--danger-text', '--danger-bg', 4.5],
  ['--info-text', '--info-bg', 4.5],
  ['--hl-comment', '--surface-code', 4.5],
  ['--hl-keyword', '--surface-code', 4.5],
  ['--hl-string', '--surface-code', 4.5],
  ['--hl-number', '--surface-code', 4.5],
  ['--hl-title', '--surface-code', 4.5],
  ['--hl-type', '--surface-code', 4.5],
  ['--hl-tag', '--surface-code', 4.5],
];

describe.each(Object.entries(themes))('%s theme tokens', (_name, tokens) => {
  it.each(REQUIRED)('%s on %s reaches a contrast of %s', (foreground, background, minimum) => {
    const fg = tokens.get(foreground);
    const bg = tokens.get(background);
    expect(fg, `${foreground} is defined`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bg, `${background} is defined`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(fg ?? '', bg ?? '')).toBeGreaterThanOrEqual(minimum);
  });
});

describe('window background', () => {
  it.each(['light', 'dark'] as const)(
    'matches the %s document surface so the window never flashes a different colour',
    (theme) => {
      expect(WINDOW_BACKGROUND[theme].toLowerCase()).toBe(
        themes[theme].get('--surface-document')?.toLowerCase(),
      );
    },
  );
});
