import type { TextEncodingName } from '../shared/types';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

function startsWith(buffer: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => buffer[index] === byte);
}

/**
 * Decodes a text file the way Windows editors write them: UTF-8 (with or
 * without a byte order mark), UTF-16 with a byte order mark (older Notepad
 * "Unicode" files), and legacy ANSI files, which are read as Windows-1252.
 */
export function decodeText(buffer: Uint8Array): DecodedText {
  if (startsWith(buffer, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf-16le' };
  }
  if (startsWith(buffer, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'utf-16be' };
  }

  try {
    // A fatal decoder rejects invalid sequences; it strips a leading BOM itself.
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' };
  }
}
