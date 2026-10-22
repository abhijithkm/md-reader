import type { Element, Root } from 'hast';
import { describe, expect, it } from 'vitest';
import {
  MAX_HIGHLIGHT_CHARACTERS,
  MAX_HIGHLIGHT_LINE_LENGTH,
  rehypeLimitHighlighting,
} from './highlight-limits';

function codeBlock(text: string, className: string[] = ['language-ini']): Root {
  const code: Element = {
    type: 'element',
    tagName: 'code',
    properties: { className },
    children: [{ type: 'text', value: text }],
  };
  return {
    type: 'root',
    children: [{ type: 'element', tagName: 'pre', properties: {}, children: [code] }],
  };
}

/** The class names left on the code element after the plugin has run. */
function classesAfter(tree: Root): unknown {
  rehypeLimitHighlighting()(tree);
  const pre = tree.children[0] as Element;
  return (pre.children[0] as Element).properties.className;
}

describe('rehypeLimitHighlighting', () => {
  it('leaves ordinary code to be highlighted', () => {
    const code = 'let a = 1;\nlet b = 2;\n'.repeat(100);
    expect(classesAfter(codeBlock(code, ['language-js']))).toEqual(['language-js']);
  });

  it('takes the language off a block with a very long line, so it is shown as plain text', () => {
    // highlight.js takes time quadratic in the length of a line: minutes for a 200 KB one.
    const code = `short line\n${'x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH + 1)}\nshort line\n`;
    expect(classesAfter(codeBlock(code))).toEqual([]);
  });

  it('accepts a line exactly at the limit', () => {
    const code = 'x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH);
    expect(classesAfter(codeBlock(code))).toEqual(['language-ini']);
  });

  it('takes the language off a block that is very large even though its lines are short', () => {
    const code = `${'let a = 1;\n'.repeat(Math.ceil(MAX_HIGHLIGHT_CHARACTERS / 10) + 1)}`;
    expect(classesAfter(codeBlock(code, ['language-js']))).toEqual([]);
  });

  it('keeps other class names', () => {
    const code = 'x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH + 1);
    expect(classesAfter(codeBlock(code, ['language-ini', 'custom']))).toEqual(['custom']);
  });

  it('does nothing to code that names no language', () => {
    const code = 'x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH + 1);
    expect(classesAfter(codeBlock(code, []))).toEqual([]);
  });
});
