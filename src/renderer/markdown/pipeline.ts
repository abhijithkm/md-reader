import type { Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { highlightLanguages } from './highlight-languages';
import { rehypeLimitHighlighting } from './highlight-limits';

type RehypePlugins = NonNullable<Options['rehypePlugins']>;

/**
 * What HTML inside Markdown may contain. This starts from the GitHub-style
 * allow-list that rehype-sanitize ships (no script, style, iframe, form, object
 * or event handler attributes; author ids and names are prefixed so they cannot
 * shadow page globals) and narrows or extends only the URL schemes:
 *
 * - links: web, mail, and file: (relative links resolve to file: later);
 * - images: https, inline data: and file: only. Plain http is dropped.
 *
 * `<picture>` and `<source>` are removed: the addresses in a `srcset` are not covered by those
 * rules and never pass through the image checks in images.ts (the Content Security Policy would
 * block them anyway). The `<img>` inside a `<picture>` is kept and checked like any other.
 */
export const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter((tag) => tag !== 'picture' && tag !== 'source'),
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', 'file'],
    src: ['https', 'data', 'file'],
  },
};

export const remarkPlugins: NonNullable<Options['remarkPlugins']> = [remarkGfm];

/**
 * Raw HTML can only appear where the text has a "<" followed by a letter, "!",
 * "/" or "?". When it cannot, the HTML parser (the slowest step for large
 * documents) has nothing to do and is skipped. A false "yes" only costs time.
 */
export function mayContainHtml(source: string): boolean {
  return /<[A-Za-z!/?]/.test(source);
}

/**
 * The steps that run on the HTML tree. Order matters: raw HTML is parsed first,
 * then sanitized, and only afterwards are heading ids (`slugs`) and highlighting
 * classes added. Both would otherwise be removed or prefixed by the sanitizer.
 * Code too big or with lines too long to colour in reasonable time is marked as plain
 * text just before the highlighter runs.
 */
export function rehypePluginsFor(source: string, slugs: RehypePlugins[number]): RehypePlugins {
  return [
    ...(mayContainHtml(source) ? [rehypeRaw] : []),
    [rehypeSanitize, sanitizeSchema],
    slugs,
    rehypeLimitHighlighting,
    [rehypeHighlight, { languages: highlightLanguages, detect: false, ignoreMissing: true }],
  ];
}
