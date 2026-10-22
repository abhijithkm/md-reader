import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const tsProjects = ['./tsconfig.json', './src/renderer/tsconfig.json', './e2e/tsconfig.json'];

export default defineConfig([
  globalIgnores([
    'out/**',
    'release/**',
    'dist/**',
    'coverage/**',
    'e2e/.tmp/**',
    'node_modules/**',
    'docs/screenshots/**',
  ]),

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: tsProjects, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
    },
  },

  // The renderer runs untrusted Markdown in a sandboxed page: it must never reach
  // Node.js or Electron directly. Everything privileged goes through the preload bridge.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'electron/*',
                'node:*',
                'fs',
                'fs/*',
                'path',
                'child_process',
                'os',
              ],
              message: 'The renderer has no Node.js or Electron access. Use the preload bridge.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/main/**', 'src/preload/**', 'src/shared/**', 'tests/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },

  // End-to-end tests run in Node but pass functions into the page.
  {
    files: ['e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      // Mock functions are passed around and asserted on, not called through their owner.
      '@typescript-eslint/unbound-method': 'off',
      // Test doubles are often partial and async by shape only.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Plain JavaScript (build scripts, config): no type information.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Must stay last: turns off rules that would fight Prettier.
  prettier,
]);
