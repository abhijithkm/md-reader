import { describe, expect, it } from 'vitest';
import { splitMarkdown } from './chunks';

// Small limits so test documents stay readable.
const options = { thresholdBytes: 1000, targetBytes: 1500 };

function section(n: number, size = 300): string {
  return `## Section ${n}\n\n${'word '.repeat(Math.ceil(size / 5)).trim()}\n\n`;
}

function sections(count: number, size?: number): string {
  return Array.from({ length: count }, (_unused, n) => section(n, size)).join('');
}

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

describe('splitMarkdown', () => {
  it('keeps a small document in one piece', () => {
    expect(splitMarkdown('# Hi\n\ntext', options)).toEqual(['# Hi\n\ntext']);
  });

  describe('a long document', () => {
    const source = sections(20);
    const chunks = splitMarkdown(source, options);

    it('is cut into several chunks that add up to the original text exactly', () => {
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(source);
    });

    it('starts every later chunk at a heading', () => {
      for (const chunk of chunks.slice(1)) expect(chunk).toMatch(/^## Section \d+\n/);
    });

    it('keeps chunks close to the target size', () => {
      for (const chunk of chunks.slice(0, -1)) {
        expect(chunk.length).toBeGreaterThanOrEqual(1500);
        expect(chunk.length).toBeLessThan(1500 + 400);
      }
    });
  });

  describe('places where it must never cut', () => {
    it.each([
      ['a backtick fence', '```md\n\n# not a heading\n\ntext\n\n## also not a heading\n\n```\n\n'],
      [
        'a tilde fence closed by a longer fence',
        '~~~\n\n# not a heading\n\n## nor this\n\n~~~~~\n\n',
      ],
    ])('inside %s', (_label, fenced) => {
      const source = sections(6) + fenced + sections(6);
      const chunks = splitMarkdown(source, { thresholdBytes: 200, targetBytes: 50 });

      expect(chunks.join('')).toBe(source);
      for (const chunk of chunks) {
        expect(count(chunk, /^(```|~~~)/gm) % 2, 'fences stay balanced').toBe(0);
        expect(chunk).not.toMatch(/^# not a heading/);
        expect(chunk).not.toMatch(/^## (also not a heading|nor this)/);
      }
    });

    it('inside an HTML comment or a pre block', () => {
      const hidden =
        '<!--\n\n## hidden heading\n\n-->\n\n<pre>\n\n## preformatted heading\n\n</pre>\n\n';
      const source = sections(6) + hidden + sections(6);
      const chunks = splitMarkdown(source, { thresholdBytes: 200, targetBytes: 50 });

      expect(chunks.join('')).toBe(source);
      for (const chunk of chunks) {
        expect(chunk).not.toMatch(/^## hidden heading/);
        expect(chunk).not.toMatch(/^## preformatted heading/);
      }
    });

    it('inside a block-level HTML element that is still open', () => {
      const source = `${sections(3)}<details>\n<summary>More</summary>\n\n${sections(8)}</details>\n\n${sections(3)}`;
      const chunks = splitMarkdown(source, { thresholdBytes: 200, targetBytes: 50 });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(count(chunk, /<details>/g), 'opening and closing tags stay together').toBe(
          count(chunk, /<\/details>/g),
        );
      }
    });

    it('anywhere after a code fence that never closes', () => {
      const source = `${sections(3)}\`\`\`\n${sections(10)}`;
      const chunks = splitMarkdown(source, { thresholdBytes: 200, targetBytes: 50 });

      const withFence = chunks.findIndex((chunk) => chunk.includes('```'));
      expect(withFence).toBe(chunks.length - 1);
    });

    it('when the document has footnotes, which must stay with their references', () => {
      const source = `Text with a note[^1].\n\n${sections(20)}[^1]: The note.\n`;
      expect(splitMarkdown(source, options)).toEqual([source]);
    });
  });

  describe('where it may cut', () => {
    it('only before a heading or a paragraph, never before a list, quote, table, code or definition', () => {
      const blocks = [
        'Paragraph text.\n\n',
        '- list item\n\n',
        '> quoted\n\n',
        '| a | b |\n| - | - |\n| 1 | 2 |\n\n',
        '    indented code\n\n',
        '1. ordered item\n\n',
        '[ref]: https://example.test\n\n',
      ];
      const source = Array.from({ length: 30 }, () => blocks.join('')).join('');
      const chunks = splitMarkdown(source, { thresholdBytes: 100, targetBytes: 10 });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks.slice(1)) expect(chunk).toMatch(/^Paragraph text\./);
    });

    it('splits prose that has no headings at paragraph boundaries', () => {
      const source = Array.from(
        { length: 60 },
        (_unused, n) => `Paragraph ${n} ${'text '.repeat(40)}\n\n`,
      ).join('');
      const chunks = splitMarkdown(source, options);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(source);
    });

    it('handles Windows line endings', () => {
      const source = sections(20).replaceAll('\n', '\r\n');
      const chunks = splitMarkdown(source, options);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(source);
      for (const chunk of chunks.slice(1)) expect(chunk).toMatch(/^## Section \d+\r\n/);
    });

    it('leaves a document whole when it has no safe place to cut', () => {
      const source = '- item\n'.repeat(500);
      expect(splitMarkdown(source, options)).toEqual([source]);
    });
  });

  describe('link reference definitions', () => {
    it('are repeated in every chunk so links keep working wherever they are used', () => {
      const definition = '[ref]: https://example.com "Title"';
      const source = `${section(0)}See [the site][ref].\n\n${sections(20)}${definition}\n`;
      const chunks = splitMarkdown(source, options);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) expect(chunk).toContain(definition);
    });

    it('are not mistaken for footnotes or code', () => {
      const source = `${sections(20)}\`\`\`\n[hidden]: https://example.test\n\`\`\`\n`;
      const chunks = splitMarkdown(source, options);

      expect(chunks.length).toBeGreaterThan(1);
      // The line inside the code fence appears only where it was written.
      expect(count(chunks.join(''), /\[hidden\]:/g)).toBe(1);
    });
  });

  describe('hostile input', () => {
    it('splits a very long line of unclosed tags in linear time', () => {
      // 80 KB of "<div " with no ">" anywhere. The pattern that finds opening tags used to scan
      // the rest of the line from every "<", which took about a second here and over an hour
      // for a 5 MB file.
      const source = `${section(0)}${'<div '.repeat(16_000)}\n\n${section(1)}`;

      const started = performance.now();
      splitMarkdown(source, options);

      expect(performance.now() - started).toBeLessThan(300);
    });

    it('repeats only a limited amount of link definitions into each chunk', () => {
      const definitions = Array.from(
        { length: 5000 },
        (_unused, n) => `[ref${n}]: https://example.com/${n}`,
      ).join('\n');
      const chunks = splitMarkdown(`${sections(20)}${definitions}\n`, options);

      expect(chunks.length).toBeGreaterThan(1);
      // Without a limit each of these would carry all 5000 definitions, about 150 KB.
      for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBeLessThan(40_000);
    });
  });
});
