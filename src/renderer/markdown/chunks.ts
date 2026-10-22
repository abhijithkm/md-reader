export interface ChunkOptions {
  /** Documents up to this many characters are rendered in one piece. */
  thresholdBytes?: number;
  /** Aim for chunks of about this many characters. */
  targetBytes?: number;
}

/** Documents up to this size are rendered in one piece. */
export const CHUNK_THRESHOLD = 64 * 1024;
/** Chunks aim for this size: small enough that parsing one never freezes the window. */
export const CHUNK_TARGET = 32 * 1024;
/**
 * Link definitions are repeated in every chunk. At most this many characters of them are, so a
 * file with thousands of definitions cannot make every chunk several times bigger than intended.
 */
const MAX_REPLAYED_DEFINITIONS = CHUNK_TARGET / 2;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const COMMENT_OPEN = /^ {0,3}<!--/;
const RAW_BLOCK_OPEN = /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i;
const HEADING = /^#{1,6}(?:[ \t]|$)/;
const PARAGRAPH_START = /^[A-Za-z0-9]/;
const ORDERED_ITEM = /^\d{1,9}[.)](?:[ \t]|$)/;
const DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*\S/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]\r\n]+\]:/m;

// Block-level HTML whose content can contain Markdown and span many blocks. The
// sanitizer needs the opening and closing tag in the same piece to rebuild it.
const BLOCK_TAGS =
  'details|div|table|blockquote|section|article|aside|header|footer|nav|main|figure|picture|center|ul|ol|dl|form';
// The attributes stop at the next "<" as well as at ">". Without that, a line made of thousands of
// unclosed "<div " would be scanned to its end from every one of them (quadratic time).
const OPEN_TAG = new RegExp(`<(?:${BLOCK_TAGS})(?=[\\s>/])[^<>]*>`, 'gi');
const CLOSE_TAG = new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi');

/**
 * Splits a long document into pieces that can be parsed one at a time.
 *
 * The Markdown parser slows down more than linearly on documents with a great
 * many small blocks (a 1 MB changelog took 12 seconds), and it runs in one
 * uninterrupted stretch. Rendering the pieces one after another keeps the
 * window responsive and the total time close to linear.
 *
 * A cut is only made where it cannot change the result: at the start of a
 * heading, or (in a long stretch without one) at the start of a paragraph, that
 * follows a blank line; outside code fences, HTML comments and `<pre>` blocks;
 * and not while a block-level HTML element such as `<details>` is still open.
 * Link reference definitions are repeated in every piece so references keep
 * resolving. Documents with footnotes are never split: footnotes are numbered
 * and collected across the whole text.
 *
 * The pieces joined together are the original text (plus those repeated
 * definitions).
 */
export function splitMarkdown(source: string, options: ChunkOptions = {}): string[] {
  const threshold = options.thresholdBytes ?? CHUNK_THRESHOLD;
  const target = options.targetBytes ?? CHUNK_TARGET;
  if (source.length <= threshold || FOOTNOTE_DEFINITION.test(source)) return [source];

  const starts: number[] = [0];
  /** Every link definition, with the offset of its line. */
  const definitions: { offset: number; text: string }[] = [];
  /** The ones that are repeated into the other chunks: the first ones, up to the limit. */
  const replayed: string[] = [];
  let replayedSize = 0;
  let fence: { character: string; length: number } | undefined;
  let rawBlockEnd: RegExp | undefined;
  let openHtml = 0;
  let previousBlank = true;

  for (let offset = 0; offset < source.length;) {
    const newline = source.indexOf('\n', offset);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(offset, lineEnd).replace(/\r$/, '');
    const chunkStart = starts[starts.length - 1] ?? 0;

    if (fence !== undefined) {
      const close = FENCE_CLOSE.exec(line);
      const marker = close?.[1] ?? '';
      if (marker[0] === fence.character && marker.length >= fence.length) fence = undefined;
      previousBlank = false;
    } else if (rawBlockEnd !== undefined) {
      if (rawBlockEnd.test(line)) rawBlockEnd = undefined;
      previousBlank = false;
    } else {
      const open = FENCE_OPEN.exec(line);
      const marker = open?.[1] ?? '';
      // A backtick fence cannot have a backtick in its info string.
      if (marker !== '' && !(marker[0] === '`' && (open?.[2] ?? '').includes('`'))) {
        fence = { character: marker[0] ?? '`', length: marker.length };
        previousBlank = false;
      } else {
        const size = offset - chunkStart;
        const isHeading = HEADING.test(line);
        const isParagraph = PARAGRAPH_START.test(line) && !ORDERED_ITEM.test(line);
        const canCut =
          previousBlank &&
          openHtml <= 0 &&
          size > 0 &&
          ((isHeading && size >= target) || (isParagraph && size >= 2 * target));
        if (canCut) starts.push(offset);

        if (DEFINITION.test(line)) {
          const text = line.trim();
          definitions.push({ offset, text });
          if (replayedSize + text.length + 1 <= MAX_REPLAYED_DEFINITIONS) {
            replayed.push(text);
            replayedSize += text.length + 1;
          }
        }
        rawBlockEnd = rawBlockEndFor(line);
        openHtml = Math.max(0, openHtml + htmlDepthChange(line));
        previousBlank = line.trim() === '';
      }
    }

    offset = newline === -1 ? source.length : newline + 1;
  }

  if (starts.length === 1) return [source];

  const chunks = starts.map((start, index) =>
    source.slice(start, starts[index + 1] ?? source.length),
  );
  if (replayed.length === 0) return chunks;

  // The definitions are in document order, so one pass over them finds those inside each chunk.
  let next = 0;
  return chunks.map((chunk, index) => {
    const end = starts[index + 1] ?? source.length;
    const written = new Set<string>();
    for (; next < definitions.length && (definitions[next]?.offset ?? end) < end; next += 1) {
      written.add(definitions[next]?.text ?? '');
    }
    const missing = replayed.filter((definition) => !written.has(definition));
    if (missing.length === 0) return chunk;
    return `${chunk}${chunk.endsWith('\n') ? '\n' : '\n\n'}${missing.join('\n')}\n`;
  });
}

/** The pattern that ends an HTML comment or raw block that starts on this line, if it does not end on it. */
function rawBlockEndFor(line: string): RegExp | undefined {
  if (COMMENT_OPEN.test(line)) {
    return line.indexOf('-->', line.indexOf('<!--') + 4) === -1 ? /-->/ : undefined;
  }
  const raw = RAW_BLOCK_OPEN.exec(line);
  const tag = raw?.[1];
  if (tag === undefined) return undefined;
  const closing = new RegExp(`</${tag}>`, 'i');
  return closing.test(line) ? undefined : closing;
}

function htmlDepthChange(line: string): number {
  if (!line.includes('<')) return 0;
  const opened = (line.match(OPEN_TAG) ?? []).filter((tag) => !tag.endsWith('/>')).length;
  const closed = (line.match(CLOSE_TAG) ?? []).length;
  return opened - closed;
}
