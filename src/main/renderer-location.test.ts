import { describe, expect, it } from 'vitest';
import { resolveRendererLocation } from './renderer-location';

const DEV_SERVER = 'http://localhost:5173/';

describe('resolveRendererLocation', () => {
  it('loads the bundled page from the app origin when nothing is set', () => {
    expect(resolveRendererLocation({ isPackaged: true, env: {} })).toEqual({
      url: 'app://md-reader/index.html',
      trustedOrigins: ['app://md-reader'],
    });
  });

  it('uses the development server in a development build, and trusts only its origin', () => {
    expect(
      resolveRendererLocation({
        isPackaged: false,
        env: { ELECTRON_RENDERER_URL: `${DEV_SERVER}index.html` },
      }),
    ).toEqual({ url: `${DEV_SERVER}index.html`, trustedOrigins: ['http://localhost:5173'] });
  });

  it('ignores the variable in a packaged app, where it would load any page with full access', () => {
    expect(
      resolveRendererLocation({
        isPackaged: true,
        env: { ELECTRON_RENDERER_URL: 'https://evil.example/page' },
      }),
    ).toEqual({ url: 'app://md-reader/index.html', trustedOrigins: ['app://md-reader'] });
  });

  it.each(['', 'not a url'])('falls back to the bundled page for the value %j', (value) => {
    expect(
      resolveRendererLocation({ isPackaged: false, env: { ELECTRON_RENDERER_URL: value } }),
    ).toEqual({ url: 'app://md-reader/index.html', trustedOrigins: ['app://md-reader'] });
  });
});
