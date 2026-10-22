import { describe, expect, it } from 'vitest';
import { resolveImageSource } from './images';

const base = 'file:///C:/docs/guide/';
const local = (fileUrl: string) => `mdreader-local://image/?u=${encodeURIComponent(fileUrl)}`;

describe('resolveImageSource', () => {
  it.each([
    ['images/logo.png', local('file:///C:/docs/guide/images/logo.png')],
    ['./logo.png', local('file:///C:/docs/guide/logo.png')],
    ['../shared/logo.png', local('file:///C:/docs/shared/logo.png')],
    ['my%20pic.png', local('file:///C:/docs/guide/my%20pic.png')],
    ['pics/a b.png', local('file:///C:/docs/guide/pics/a%20b.png')],
    ['图片/猫.png', local('file:///C:/docs/guide/%E5%9B%BE%E7%89%87/%E7%8C%AB.png')],
    ['file:///D:/other/x.png', local('file:///D:/other/x.png')],
  ])('loads %s through the local image scheme', (src, url) => {
    expect(resolveImageSource(src, base)).toEqual({ kind: 'local', url });
  });

  it('keeps https images as they are', () => {
    expect(resolveImageSource('https://img.shields.io/badge/a-b-green.svg', base)).toEqual({
      kind: 'remote',
      url: 'https://img.shields.io/badge/a-b-green.svg',
    });
  });

  it('accepts small inline images', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveImageSource(png, base)).toEqual({ kind: 'data', url: png });
    const svg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(resolveImageSource(svg, base)).toEqual({ kind: 'data', url: svg });
  });

  it.each([
    ['plain http', 'http://example.com/a.png'],
    ['a data URL that is not an image', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a javascript URL', 'javascript:alert(1)'],
    ['an unknown scheme', 'ftp://example.com/a.png'],
    ['an empty value', ''],
  ])('blocks %s', (_label, src) => {
    expect(resolveImageSource(src, base)).toEqual({ kind: 'blocked' });
  });

  it('blocks a missing source', () => {
    expect(resolveImageSource(undefined, base)).toEqual({ kind: 'blocked' });
  });
});
