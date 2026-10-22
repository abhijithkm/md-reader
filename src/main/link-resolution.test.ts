import { describe, expect, it } from 'vitest';
import { resolveLocalMarkdownLink } from './link-resolution';

const onWindows = process.platform === 'win32';

describe.skipIf(!onWindows)('resolveLocalMarkdownLink', () => {
  const current = 'C:\\docs\\index.md';

  it('resolves a link to another Markdown file', () => {
    expect(resolveLocalMarkdownLink('file:///C:/docs/guide.md', current)).toEqual({
      ok: true,
      path: 'C:\\docs\\guide.md',
    });
  });

  it('decodes the path and returns the anchor', () => {
    expect(
      resolveLocalMarkdownLink('file:///C:/docs/My%20Guide%20%E6%97%A5.md#install-steps', current),
    ).toEqual({ ok: true, path: 'C:\\docs\\My Guide 日.md', anchor: 'install-steps' });
  });

  it('decodes a percent-encoded anchor', () => {
    expect(resolveLocalMarkdownLink('file:///C:/docs/a.md#caf%C3%A9', current)).toMatchObject({
      ok: true,
      anchor: 'café',
    });
  });

  it('ignores an empty anchor and the query string', () => {
    expect(resolveLocalMarkdownLink('file:///C:/docs/a.markdown?x=1#', current)).toEqual({
      ok: true,
      path: 'C:\\docs\\a.markdown',
    });
  });

  it.each(['file:///C:/docs/readme.txt', 'file:///C:/docs/setup.exe', 'file:///C:/docs/'])(
    'refuses to open %s as a document',
    (href) => {
      expect(resolveLocalMarkdownLink(href, current)).toEqual({
        ok: false,
        reason: 'unsupported-type',
      });
    },
  );

  it.each([
    'https://example.com/a.md',
    'javascript:alert(1)',
    'a.md',
    'file:///C:/docs%2Fa.md',
    '',
    42,
    null,
    undefined,
  ])('rejects %j as not a usable local link', (href) => {
    expect(resolveLocalMarkdownLink(href, current)).toEqual({ ok: false, reason: 'invalid-url' });
  });

  it('refuses a network share the current document is not on', () => {
    expect(resolveLocalMarkdownLink('file://evil.example/share/a.md', current)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });

  it('follows a link within the share the current document lives on', () => {
    expect(
      resolveLocalMarkdownLink('file://server/share/docs/b.md', '\\\\server\\share\\docs\\a.md'),
    ).toEqual({ ok: true, path: '\\\\server\\share\\docs\\b.md' });
  });

  it('refuses reserved device names', () => {
    expect(resolveLocalMarkdownLink('file:///C:/docs/CON.md', current)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });
});
