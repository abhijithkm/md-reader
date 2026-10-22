import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAppRequest } from './app-protocol';

let sandbox: string;
let root: string;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'mdreader-app-'));
  root = path.join(sandbox, 'renderer');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(path.join(root, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(path.join(root, 'assets', 'style.css'), 'body{}');
  await writeFile(
    path.join(root, 'assets', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  await writeFile(path.join(sandbox, 'secret.txt'), 'top secret');
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const deps = () => ({ rootDir: root, readFile: (filePath: string) => readFile(filePath) });
const get = (url: string) => handleAppRequest(new Request(url), deps());

describe('handleAppRequest', () => {
  it.each([
    ['app://md-reader/', 'text/html; charset=utf-8'],
    ['app://md-reader/index.html', 'text/html; charset=utf-8'],
    ['app://md-reader/index.html?x=1#frag', 'text/html; charset=utf-8'],
    ['app://md-reader/assets/app.js', 'text/javascript; charset=utf-8'],
    ['app://md-reader/assets/style.css', 'text/css; charset=utf-8'],
    ['app://md-reader/assets/logo.svg', 'image/svg+xml'],
  ])('serves %s as %s', async (url, type) => {
    const response = await get(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(type);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns the file contents', async () => {
    expect(await (await get('app://md-reader/assets/app.js')).text()).toBe('console.log(1)');
  });

  it.each(['app://md-reader/missing.js', 'app://md-reader/assets/', 'app://other-host/index.html'])(
    'answers 404 for %s',
    async (url) => {
      expect((await get(url)).status).toBe(404);
    },
  );

  it.each([
    'app://md-reader/..%5C..%5Csecret.txt',
    'app://md-reader/%2e%2e/secret.txt',
    'app://md-reader/assets/..%2F..%2Fsecret.txt',
    'app://md-reader/assets/%2e%2e%5c%2e%2e%5csecret.txt',
    'app://md-reader/../secret.txt',
  ])('never serves a file outside the app folder: %s', async (url) => {
    const response = await get(url);
    expect([400, 403, 404]).toContain(response.status);
    expect(await response.text()).not.toContain('top secret');
  });

  it('refuses malformed percent-encoding', async () => {
    expect((await get('app://md-reader/%E0%A4%A')).status).toBe(400);
  });

  it('answers 405 for anything but GET', async () => {
    const response = await handleAppRequest(
      new Request('app://md-reader/index.html', { method: 'POST', body: 'x' }),
      deps(),
    );
    expect(response.status).toBe(405);
  });
});
