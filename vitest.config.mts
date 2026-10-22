import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: false,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'tests/**/*.test.ts',
          ],
          restoreMocks: true,
        },
      },
      {
        extends: false,
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup/renderer.ts'],
          testTimeout: 15_000,
          restoreMocks: true,
        },
      },
    ],
  },
});
