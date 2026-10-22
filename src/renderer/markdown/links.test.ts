import { describe, expect, it } from 'vitest';
import { classifyLink } from './links';

const base = 'file:///C:/docs/guide/';

describe('classifyLink', () => {
  it.each([
    ['#install', { kind: 'anchor', id: 'install' }],
    ['#caf%C3%A9', { kind: 'anchor', id: 'café' }],
    ['#%E6%97%A5%E6%9C%AC%E8%AA%9E', { kind: 'anchor', id: '日本語' }],
    ['https://example.com/a?b=1#c', { kind: 'external', url: 'https://example.com/a?b=1#c' }],
    ['http://example.com', { kind: 'external', url: 'http://example.com/' }],
    ['mailto:ada@example.com', { kind: 'external', url: 'mailto:ada@example.com' }],
    ['setup.md', { kind: 'local', fileUrl: 'file:///C:/docs/guide/setup.md' }],
    ['../README.md#usage', { kind: 'local', fileUrl: 'file:///C:/docs/README.md#usage' }],
    ['My%20File.md', { kind: 'local', fileUrl: 'file:///C:/docs/guide/My%20File.md' }],
    ['file:///D:/other/a.md', { kind: 'local', fileUrl: 'file:///D:/other/a.md' }],
  ])('classifies %s', (href, expected) => {
    expect(classifyLink(href, base)).toEqual(expected);
  });

  it('leaves the decision about network locations to the main process', () => {
    expect(classifyLink('//evil.example/share/a.md', base)).toEqual({
      kind: 'local',
      fileUrl: 'file://evil.example/share/a.md',
    });
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ms-settings:defaultapps',
    'steam://run/1',
    'https://',
    '',
    undefined,
  ])('blocks %j', (href) => {
    expect(classifyLink(href, base)).toEqual({ kind: 'blocked' });
  });
});
