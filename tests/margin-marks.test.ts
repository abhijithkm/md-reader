import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  path.join(process.cwd(), 'src', 'renderer', 'styles', 'markdown.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The marks of the Markdown source that hang in the margin of a document, and what they mark. */
const MARKS: readonly (readonly [selector: string, mark: string])[] = [
  ['h1', '#'],
  ['h2', '##'],
  ['h3', '###'],
  ['h4', '####'],
  ['h5', '#####'],
  ['h6', '######'],
  ['blockquote', '>'],
  ['pre', '```'],
  ['hr', '---'],
];

/**
 * The `content` that the rule for `selector::before` alone gives it, as written: the string and its
 * alternative. Rules that style several marks together are not the one that says which mark it is.
 */
function contentOf(selector: string): string | undefined {
  const wanted = `.markdown-body ${selector}::before`;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = (selectors ?? '').split(',').map((part) => part.trim());
    if (list.length !== 1 || list[0] !== wanted) continue;
    const content = /content:\s*([^;]+);/.exec(body ?? '')?.[1]?.trim();
    if (content !== undefined) return content;
  }
  return undefined;
}

describe('the marks of the source in the margin', () => {
  it.each(MARKS)('puts the mark of %s in the margin', (selector, mark) => {
    expect(contentOf(selector)).toBeDefined();
    expect(contentOf(selector)?.startsWith(`'${mark}'`)).toBe(true);
  });

  // The marks are for the eye. Text after the slash is the alternative a screen reader is given, and
  // an empty one means nothing is read out, so that "hash hash" is never heard before a heading.
  it.each(MARKS)('keeps the mark of %s away from screen readers', (selector) => {
    expect(contentOf(selector)).toMatch(/ \/ ''$/);
  });

  it('leaves them out of a window too narrow to hold them', () => {
    const narrow = /@media \(max-width: 720px\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? '';
    for (const [selector] of MARKS) {
      expect(narrow, selector).toContain(`.markdown-body ${selector}::before`);
    }
    expect(narrow).toMatch(/display:\s*none/);
  });

  it('draws them with CSS, so a selection or a copy never includes them', () => {
    expect(css).toMatch(/user-select:\s*none/);
    expect(css).toMatch(/pointer-events:\s*none/);
  });
});
