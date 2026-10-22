import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { buildContentSecurityPolicy } from './src/shared/csp';

/** Writes the Content Security Policy into index.html (strict in builds, relaxed for the dev server). */
function contentSecurityPolicy(development: boolean): Plugin {
  const policy = buildContentSecurityPolicy({ development });
  return {
    name: 'md-reader:content-security-policy',
    transformIndexHtml: (html) => html.replace('__CSP__', policy),
  };
}

export default defineConfig(({ command }) => ({
  main: {},
  preload: {},
  renderer: {
    base: './',
    plugins: [react(), contentSecurityPolicy(command === 'serve')],
    // The bundle is read from disk, not downloaded, so the default size warning does not apply.
    build: { minify: true, chunkSizeWarningLimit: 2000 },
  },
}));
