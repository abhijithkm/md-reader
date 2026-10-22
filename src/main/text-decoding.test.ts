import { describe, expect, it } from 'vitest';
import { decodeText } from './text-decoding';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('decodeText', () => {
  it('decodes plain UTF-8', () => {
    // "héllo"
    expect(decodeText(bytes(0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f))).toEqual({
      text: 'héllo',
      encoding: 'utf-8',
    });
  });

  it('strips a UTF-8 byte order mark', () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x68, 0x69))).toEqual({
      text: 'hi',
      encoding: 'utf-8',
    });
  });

  it('decodes multi-byte CJK text and emoji', () => {
    // 日本語 followed by U+1F600
    const input = bytes(
      0xe6,
      0x97,
      0xa5,
      0xe6,
      0x9c,
      0xac,
      0xe8,
      0xaa,
      0x9e,
      0xf0,
      0x9f,
      0x98,
      0x80,
    );
    expect(decodeText(input).text).toBe('日本語\u{1F600}');
  });

  it('decodes UTF-16 little endian with a byte order mark', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00))).toEqual({
      text: 'hé',
      encoding: 'utf-16le',
    });
  });

  it('decodes UTF-16 big endian with a byte order mark', () => {
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9))).toEqual({
      text: 'hé',
      encoding: 'utf-16be',
    });
  });

  it('falls back to Windows-1252 when the bytes are not valid UTF-8', () => {
    // Word-style curly quotes around "Hi"
    expect(decodeText(bytes(0x93, 0x48, 0x69, 0x94))).toEqual({
      text: '“Hi”',
      encoding: 'windows-1252',
    });
  });

  it('keeps valid UTF-8 that happens to look like mojibake', () => {
    // "Ã©" is valid UTF-8 and must not be re-read as Windows-1252
    expect(decodeText(bytes(0xc3, 0x83, 0xc2, 0xa9))).toEqual({
      text: 'Ã©',
      encoding: 'utf-8',
    });
  });

  it('returns an empty string for an empty file', () => {
    expect(decodeText(bytes())).toEqual({ text: '', encoding: 'utf-8' });
  });
});
