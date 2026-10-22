export interface TextStats {
  words: number;
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 200;

// Intl.Segmenter understands scripts that do not separate words with spaces,
// which plain whitespace splitting would count as a single word.
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

export function computeTextStats(text: string): TextStats {
  let words = 0;
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.isWordLike) words += 1;
  }
  return { words, readingMinutes: words === 0 ? 0 : Math.ceil(words / WORDS_PER_MINUTE) };
}

/** Number of lines in the source; a trailing newline does not start a new line. */
export function countLines(source: string): number {
  if (source === '') return 0;
  const lines = source.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}
