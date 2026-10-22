import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { describe, expect, it } from 'vitest';
import { rehypeLimitHighlighting } from './highlight-limits';
import { mayContainHtml, rehypePluginsFor } from './pipeline';

describe('mayContainHtml', () => {
  it.each([
    '<div>x</div>',
    'text <b>bold</b>',
    '<!-- comment -->',
    '</div>',
    '<?php echo 1; ?>',
    '<https://example.com>',
    'a<b',
  ])('says yes for %j', (source) => {
    expect(mayContainHtml(source)).toBe(true);
  });

  it.each(['', 'plain text', 'a < b and 3 <4', 'x << y', '1 <= 2', '<', '< div>'])(
    'says no for %j',
    (source) => {
      expect(mayContainHtml(source)).toBe(false);
    },
  );
});

describe('rehypePluginsFor', () => {
  const slugs = () => () => undefined;
  const names = (plugins: ReturnType<typeof rehypePluginsFor>) =>
    plugins.map((entry) => (Array.isArray(entry) ? entry[0] : entry));

  it('parses raw HTML first, then sanitizes it, then adds ids and highlighting', () => {
    expect(names(rehypePluginsFor('<b>x</b>', slugs))).toEqual([
      rehypeRaw,
      rehypeSanitize,
      slugs,
      rehypeLimitHighlighting,
      rehypeHighlight,
    ]);
  });

  it('skips the HTML parser for text with no tag in it, but still sanitizes', () => {
    expect(names(rehypePluginsFor('plain *text*', slugs))).toEqual([
      rehypeSanitize,
      slugs,
      rehypeLimitHighlighting,
      rehypeHighlight,
    ]);
  });

  it('decides which code is too big to highlight before the highlighter runs', () => {
    const order = names(rehypePluginsFor('x', slugs));
    expect(order.indexOf(rehypeLimitHighlighting)).toBeLessThan(order.indexOf(rehypeHighlight));
  });
});
