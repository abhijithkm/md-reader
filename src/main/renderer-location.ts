import { APP_ORIGIN } from './app-protocol';

export interface RendererLocation {
  /** The address the window loads its page from. */
  url: string;
  /** The origins whose pages may talk to the main process. */
  trustedOrigins: string[];
}

/**
 * Where the page is loaded from: the bundled files behind `app://md-reader/`, or in development
 * the Vite server named by ELECTRON_RENDERER_URL.
 *
 * A packaged app ignores that variable. The page it loads gets the preload bridge and is trusted by
 * the main process, so anyone who could set an environment variable for the process could
 * otherwise point the window at a page of their own.
 */
export function resolveRendererLocation(options: {
  isPackaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
}): RendererLocation {
  const bundled: RendererLocation = {
    url: `${APP_ORIGIN}/index.html`,
    trustedOrigins: [APP_ORIGIN],
  };
  if (options.isPackaged) return bundled;

  const devServerUrl = options.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl === undefined || devServerUrl === '') return bundled;
  try {
    return { url: devServerUrl, trustedOrigins: [new URL(devServerUrl).origin] };
  } catch {
    return bundled;
  }
}
