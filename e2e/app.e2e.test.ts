import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeWithRetries } from './support/fixtures';
import { launchApp, type RunningApp } from './support/launch';

interface BridgeProbe {
  mdReader?: { getAppInfo(): Promise<{ name: string; version: string; platform: string }> };
}

let userDataDir: string;
let app: RunningApp | undefined;

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(os.tmpdir(), 'mdreader-e2e-profile-'));
});

afterEach(async () => {
  await app?.kill();
  app = undefined;
  await removeWithRetries(userDataDir);
});

describe('application shell', () => {
  it('serves the page from the app origin with the bridge, a strict CSP and no Node access', async () => {
    app = await launchApp({ userDataDir });

    expect(app.page.url()).toMatch(/^app:\/\/md-reader\//);
    const probe = await app.page.evaluate(async () => {
      const bridge = (window as unknown as BridgeProbe).mdReader;
      const scope = globalThis as unknown as Record<string, unknown>;
      return {
        info: await bridge?.getAppInfo(),
        csp: document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content'),
        nodeGlobals: [typeof scope['require'], typeof scope['process'], typeof scope['module']],
      };
    });

    expect(probe.info).toMatchObject({ name: 'MD Reader', platform: 'win32' });
    expect(probe.csp).toContain("script-src 'self'");
    expect(probe.nodeGlobals).toEqual(['undefined', 'undefined', 'undefined']);
  });
});
