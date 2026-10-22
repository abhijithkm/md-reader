/** Most quote marks and list markers one line may start with. Real documents use a handful. */
export const MAX_CONTAINER_MARKERS = 100;
/** Furthest a line may be indented, in columns (a tab counts as four). */
export const MAX_INDENT_COLUMNS = 400;

const SPACE = 0x20;
const TAB = 0x09;
const GREATER_THAN = 0x3e;
const NEWLINE = 0x0a;

/**
 * Whether the document stacks quotes or lists so deeply that formatting it is unsafe.
 *
 * Markdown nests: `> > > text` is a quote in a quote in a quote. The parsers handle that
 * recursively, and their work grows with the square of the depth, so a few kilobytes of `> `
 * make the window hang for minutes (a 100 KB line took twenty seconds) and some thousand
 * levels overflow the stack. No real document goes near the limits here, so a document that
 * does is shown as plain text instead.
 *
 * Only the start of each line is looked at, so the check is one quick pass over the text.
 */
export function nestsTooDeeply(source: string): boolean {
  let lineStart = 0;
  while (lineStart < source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    if (lineNestsTooDeeply(source, lineStart, lineEnd)) return true;
    lineStart = lineEnd + 1;
  }
  return false;
}

/** Counts the markers and the indentation at the start of one line. */
function lineNestsTooDeeply(source: string, start: number, end: number): boolean {
  let markers = 0;
  let columns = 0;
  let index = start;

  while (index < end) {
    const code = source.charCodeAt(index);
    if (code === SPACE) {
      columns += 1;
      index += 1;
    } else if (code === TAB) {
      columns += 4;
      index += 1;
    } else if (code === GREATER_THAN) {
      markers += 1;
      index += 1;
    } else if (isBulletAt(source, index, end)) {
      markers += 1;
      index += 1;
    } else if (isDigit(code)) {
      const next = orderedMarkerEnd(source, index, end);
      if (next === -1) return false;
      markers += 1;
      index = next;
    } else {
      return false;
    }
    if (markers > MAX_CONTAINER_MARKERS || columns > MAX_INDENT_COLUMNS) return true;
  }
  return false;
}

/** A `-`, `+` or `*` that is followed by a space, a tab or the end of the line starts a list item. */
function isBulletAt(source: string, index: number, end: number): boolean {
  const character = source[index];
  if (character !== '-' && character !== '+' && character !== '*') return false;
  const next = source.charCodeAt(index + 1);
  return index + 1 >= end || next === SPACE || next === TAB || next === NEWLINE;
}

/** The index after an ordered-list marker such as `12.` or `3)` at `index`, or -1 if there is none. */
function orderedMarkerEnd(source: string, index: number, end: number): number {
  let cursor = index;
  while (cursor < end && cursor - index < 10 && isDigit(source.charCodeAt(cursor))) cursor += 1;
  const mark = source[cursor];
  if (cursor - index > 9 || (mark !== '.' && mark !== ')')) return -1;
  const after = source.charCodeAt(cursor + 1);
  return cursor + 1 >= end || after === SPACE || after === TAB ? cursor + 1 : -1;
}

const isDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;
