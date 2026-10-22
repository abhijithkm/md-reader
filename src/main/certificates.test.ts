import type { App } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { declineClientCertificates } from './certificates';

describe('declineClientCertificates', () => {
  it('stops Electron from presenting a certificate from the Windows store, and offers none', () => {
    let listener: ((...args: unknown[]) => void) | undefined;
    const app = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        expect(event).toBe('select-client-certificate');
        listener = handler;
      },
    } as unknown as Pick<App, 'on'>;
    declineClientCertificates(app);
    const event = { preventDefault: vi.fn() };
    const callback = vi.fn();

    // A server asked for a client certificate while an image was loading.
    listener?.(
      event,
      {},
      'https://attacker.example/pixel.png',
      [{ subjectName: 'Jo Smith' }],
      callback,
    );

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledExactlyOnceWith();
  });

  it('is switched on when the app starts', () => {
    const main = readFileSync(path.join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8');
    expect(main).toContain('declineClientCertificates(app)');
  });
});
