import type { Element, Root } from 'hast';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';

/** A code block larger than this is shown as plain text. */
export const MAX_HIGHLIGHT_CHARACTERS = 200_000;
/** So is a block with a line longer than this. */
export const MAX_HIGHLIGHT_LINE_LENGTH = 1_000;

/**
 * Keeps syntax highlighting from freezing the window on a hostile or accidental file.
 *
 * highlight.js takes time quadratic in the length of a line: a 16,000-character line takes about
 * two seconds and a 200 KB one minutes, and the page cannot do anything else meanwhile. Normal code
 * has short lines, so a block with a very long line (minified code, a data blob) or one that is
 * simply huge loses its `language-*` class here and is shown as plain text. The plugin that
 * highlights runs after this one and only touches code that names a language.
 */
export function rehypeLimitHighlighting() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'code') return;

      const classes = classNamesOf(node);
      if (!classes.some(isLanguageClass)) return;

      const text = toString(node);
      if (
        text.length <= MAX_HIGHLIGHT_CHARACTERS &&
        longestLine(text) <= MAX_HIGHLIGHT_LINE_LENGTH
      ) {
        return;
      }
      node.properties.className = classes.filter((name) => !isLanguageClass(name));
    });
  };
}

function classNamesOf(node: Element): string[] {
  const value = node.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

const isLanguageClass = (name: string): boolean => name.startsWith('language-');

function longestLine(text: string): number {
  let longest = 0;
  let start = 0;
  for (;;) {
    const end = text.indexOf('\n', start);
    longest = Math.max(longest, (end === -1 ? text.length : end) - start);
    if (end === -1) return longest;
    start = end + 1;
  }
}
