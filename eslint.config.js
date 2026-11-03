import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// Vitest's globals aren't in the `globals` package. Every test here imports what
// it uses from 'vitest', so this is belt-and-braces for any that stops doing so.
const vitestGlobals = {
  suite: 'readonly',
  test: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  assert: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
}

export default defineConfig([
  globalIgnores([
    'dist',
    'node_modules',
    // Untracked sibling apps with their own toolchains — not this repo's lint surface.
    'delta-rho-war-room',
    'draft-war-room',
  ]),

  // The SPA: browser globals, React hooks + fast-refresh rules.
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },

  // ETL / calibration scripts, the serverless handlers, and build config: node globals.
  {
    files: ['scripts/**/*.{js,mjs}', 'api/**/*.js', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },

  // Tests run under vitest in node.
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...vitestGlobals },
    },
  },
])
