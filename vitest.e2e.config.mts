import { defineConfig } from 'vitest/config';

// End-to-end tests drive the real Electron app (development build or the
// packaged executable) over the Chrome DevTools Protocol. They are slow and
// touch real windows, so they live behind their own config.
export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    // The large-document test can take over a minute on a slow shared runner.
    testTimeout: 150_000,
    hookTimeout: 90_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
