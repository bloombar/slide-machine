/**
 * ESLint flat config for the whole monorepo.
 * Formatting is Prettier's job (see .prettierrc) — eslint-config-prettier
 * is applied last to disable any conflicting stylistic rules.
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import i18next from 'eslint-plugin-i18next'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Underscore prefix marks intentionally unused params (e.g. the
      // required 4-arg Express error handler signature)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'warn',
    },
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // No hardcoded user-facing strings in the app UI (TECH-12). The
    // admin console is deliberately English-only (docs/I18N.md) and so is
    // excluded, as are tests, which assert on literal copy by design.
    files: ['client/src/**/*.tsx'],
    ignores: [
      'client/src/pages/Admin*.tsx',
      'client/src/components/admin/**',
      'client/src/auth/RequireAdmin.tsx',
      'client/src/**/*.test.tsx',
    ],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          // `jsx-only` rather than the default `jsx-text-only`, because a
          // good share of this app's copy is in attributes — the default
          // mode never looks at them.
          mode: 'jsx-only',
          // Only the attributes a user actually reads. An empty exclude
          // list is load-bearing: without it every other attribute (to,
          // href, role, viewBox…) would be checked too.
          'jsx-attributes': {
            include: ['aria-label', 'alt', 'title', 'placeholder'],
            exclude: [],
          },
          callees: {
            // `slot('title')` names a layout slot, not copy. Keeps the
            // plugin's own exclusions, which this list replaces.
            exclude: [
              'slot',
              'i18n(ext)?',
              't',
              'require',
              'addEventListener',
              'removeEventListener',
              'postMessage',
              'getElementById',
              'dispatch',
              'commit',
              'includes',
              'indexOf',
              'endsWith',
              'startsWith',
            ],
          },
        },
      ],
    },
  },
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
)
