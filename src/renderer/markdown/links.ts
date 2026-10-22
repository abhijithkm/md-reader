export type LinkTarget =
  /** A link within the document (`#section`). */
  | { kind: 'anchor'; id: string }
  /** A web or mail link, opened outside the app. */
  | { kind: 'external'; url: string }
  /** A link to a local file, resolved to an absolute file: URL; the main process decides. */
  | { kind: 'local'; fileUrl: string }
  /** Anything else (javascript:, data:, custom protocols...): never followed. */
  | { kind: 'blocked' };

const EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** Decides what a link in a document may do. Relative links resolve against the document's folder. */
export function classifyLink(href: string | undefined, baseUrl: string): LinkTarget {
  if (href === undefined || href.trim() === '') return { kind: 'blocked' };
  if (href.startsWith('#')) return { kind: 'anchor', id: decodeFragment(href.slice(1)) };

  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return { kind: 'blocked' };
  }

  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: 'external', url: url.href };
  if (url.protocol === 'file:') return { kind: 'local', fileUrl: url.href };
  return { kind: 'blocked' };
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
