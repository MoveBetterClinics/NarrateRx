import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import apiHandlerShape from './eslint/rules/api-handler-shape.js'
import noRawUseMutation from './eslint/rules/no-raw-use-mutation.js'
import noArbitraryTextSize from './eslint/rules/no-arbitrary-text-size.js'
import noRawApiFetch from './eslint/rules/no-raw-api-fetch.js'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**'] },
  {
    files: ['src/**/*.{js,jsx}', 'api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: '18' } },
    rules: {
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'warn',
      // React Compiler rules (react-hooks v7+) — app doesn't use React Compiler
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      // Allow production logging (console.error/.warn/.info) — only flag debug console.log.
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'warn',
    },
  },
  // Local rule: block Vercel runtime ↔ handler shape mismatches in api/* and middleware.js.
  // Also requires explicit runtime declaration — missing config → error.
  // Source: eslint/rules/api-handler-shape.js. Scoped to handler files only
  // (api/_lib/** is helpers, no default export → rule no-ops anyway, but
  // scoping out keeps the visitor cheap).
  {
    files: ['api/**/*.js', 'middleware.js'],
    ignores: ['api/_lib/**'],
    plugins: {
      narraterx: { rules: { 'api-handler-shape': apiHandlerShape } },
    },
    rules: {
      'narraterx/api-handler-shape': 'error',
    },
  },
  // Local rules for client code (src/**):
  //   no-raw-use-mutation   — ban bare `useMutation` from @tanstack/react-query
  //     outside the useAppMutation wrapper, which injects a default onError
  //     toast so failed mutations are never silent (PRs #431, #436).
  //   no-arbitrary-text-size — ban text-[Npx] arbitrary sizes.
  //   no-raw-api-fetch      — ban tokenless raw `fetch('/api/...')`; use
  //     apiFetch so the Clerk bearer token is attached (the API ignores the
  //     session cookie, so a tokenless call gets the slim/unauth shape — the
  //     PR #1064 "settings won't save" bug). Source files in eslint/rules/.
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      narraterx: {
        rules: {
          'no-raw-use-mutation': noRawUseMutation,
          'no-arbitrary-text-size': noArbitraryTextSize,
          'no-raw-api-fetch': noRawApiFetch,
        },
      },
    },
    rules: {
      'narraterx/no-raw-use-mutation': 'error',
      // Ban text-[Npx] arbitrary sizes — use text-3xs/text-2xs/Tailwind scale.
      'narraterx/no-arbitrary-text-size': 'error',
      'narraterx/no-raw-api-fetch': 'error',
    },
  },
]
