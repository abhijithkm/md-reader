import { describe, expect, it } from 'vitest';
import { isTrustedSender } from './ipc-guard';

const trusted = ['app://md-reader', 'http://localhost:5173'];

describe('isTrustedSender', () => {
  it.each([
    'app://md-reader/index.html',
    'app://md-reader/',
    'http://localhost:5173/',
    'http://localhost:5173/#/anything',
  ])('trusts %s', (url) => {
    expect(isTrustedSender(url, trusted)).toBe(true);
  });

  it.each([
    'app://md-reader.evil.example/index.html',
    'app://evil/index.html',
    'app://md-reader@evil.example/',
    'http://localhost:5174/',
    'http://localhost:5173.evil.example/',
    'https://localhost:5173/',
    'file:///C:/index.html',
    'mdreader-local://image/?u=x',
    'about:blank',
    '',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isTrustedSender(url, trusted)).toBe(false);
  });

  it.each([undefined, null, 42, {}])('rejects a non-string frame URL (%j)', (value) => {
    expect(isTrustedSender(value, trusted)).toBe(false);
  });

  it('trusts nothing when no origin is configured', () => {
    expect(isTrustedSender('app://md-reader/index.html', [])).toBe(false);
  });
});
