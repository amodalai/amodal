/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';
import headers from 'eslint-plugin-headers';
import path from 'node:path';
import url from 'node:url';

// --- ESM way to get __dirname ---
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- ---

// Determine the monorepo root (assuming eslint.config.js is at the root)
const projectRoot = __dirname;
const currentYear = new Date().getFullYear();

export default tseslint.config(
  {
    // Global ignores
    ignores: [
      'node_modules/*',
      'eslint.config.js',
      'packages/**/dist/**',
      'packages/chat-widget/dist/**',
      'packages/test-harness/**/.next/**',
      'packages/test-harness/surveillance/dist/**',
      'packages/test-harness/finops/**',
      'packages/platform-api/.next/**',
      'bundle/**',
      'package/bundle/**',
      '.integration-tests/**',
      'dist/**',
      'evals/**',
      'packages/test-utils/**',
      'references/**',
      'packages/*/src/generated/**',
      'packages/runtime/src/__fixtures__/smoke-agent/.amodal/**',
      '**/*-env.d.ts',
      '**/tailwind.config.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs['recommended-latest'],
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'], // Add this if you are using React 17+
  {
    // Settings for eslint-plugin-react
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Import specific config
    files: ['packages/cli/src/**/*.{ts,tsx}'], // Target only TS/TSX in the cli package
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        node: true,
      },
    },
    rules: {
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,
      'import/no-default-export': 'warn',
      'import/no-unresolved': 'off', // Disable for now, can be noisy with monorepos/paths
    },
  },
  {
    // General overrides and rules for the project (TS/TSX files)
    files: ['packages/*/src/**/*.{ts,tsx}'], // Target only TS/TSX in the cli package
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        node: true,
      },
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // General Best Practice Rules (subset adapted for flat config)
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      'arrow-body-style': ['error', 'as-needed'],
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-inferrable-types': [
        'error',
        { ignoreParameters: true, ignoreProperties: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Prevent async errors from bypassing catch handlers
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      'import/no-internal-modules': [
        'error',
        {
          allow: [
            'react-dom/test-utils',
            'react-dom/client',
            'memfs/lib/volume.js',
            'yargs/**',
            'msw/node',
            '@testing-library/**',
            '@codemirror/**',
            'drizzle-orm/**',
            'next/server',
            'next/navigation',
            'next/link',
            'next/image',
          ],
        },
      ],
      'import/no-relative-packages': 'error',
      'no-cond-assign': 'error',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="require"]',
          message: 'Avoid using require(). Use ES6 imports instead.',
        },
        {
          selector: 'ThrowStatement > Literal:not([value=/^\\w+Error:/])',
          message:
            'Do not throw string literals or non-Error objects. Throw new Error("...") instead.',
        },
      ],
      'no-unsafe-finally': 'error',
      'no-unused-expressions': 'off', // Disable base rule
      '@typescript-eslint/no-unused-expressions': [
        // Enable TS version
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      'no-var': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'prefer-arrow-callback': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      radix: 'error',
      'no-console': 'error',
      'default-case': 'error',
      '@typescript-eslint/await-thenable': ['error'],
      '@typescript-eslint/no-floating-promises': ['error'],
      '@typescript-eslint/no-misused-promises': ['error'],
      '@typescript-eslint/switch-exhaustiveness-check': ['error'],
      '@typescript-eslint/no-unnecessary-type-assertion': ['error'],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:os',
              importNames: ['homedir', 'tmpdir'],
              message:
                'Please use the helpers from @amodalai/core instead of node:os homedir()/tmpdir() to ensure strict environment isolation.',
            },
            {
              name: 'os',
              importNames: ['homedir', 'tmpdir'],
              message:
                'Please use the helpers from @amodalai/core instead of os homedir()/tmpdir() to ensure strict environment isolation.',
            },
          ],
        },
      ],
    },
  },
  {
    // Rules that only apply to product code
    files: ['packages/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
    },
  },
  {
    // Allow os.homedir() in tests and paths.ts where it is used to implement the helper
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'packages/test-utils/src/**/*.ts',
      'scripts/**/*.js',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Prevent self-imports in packages
    files: ['packages/core/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          name: '@amodalai/core',
          message: 'Please use relative imports within the @amodalai/core package.',
        },
      ],
    },
  },
  {
    files: ['packages/cli/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          name: '@amodalai/amodal',
          message: 'Please use relative imports within the @amodalai/amodal package.',
        },
      ],
    },
  },
  {
    files: ['packages/*/src/**/*.test.{ts,tsx}'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/expect-expect': 'off',
      'vitest/no-commented-out-tests': 'off',
      'vitest/no-conditional-expect': 'off',
      'vitest/no-standalone-expect': 'off',
      'vitest/no-mocks-import': 'off',
    },
  },
  {
    files: ['./**/*.{tsx,ts,js,cjs}'],
    plugins: {
      headers,
      import: importPlugin,
    },
    rules: {
      'headers/header-format': [
        'error',
        {
          source: 'string',
          content: [
            '@license',
            'Copyright (year) Amodal Labs, Inc.',
            'SPDX-License-Identifier: MIT',
          ].join('\n'),
          patterns: {
            year: {
              pattern: `202[5-${currentYear.toString().slice(-1)}]`,
              defaultValue: currentYear.toString(),
            },
          },
        },
      ],
      'import/enforce-node-protocol-usage': ['error', 'always'],
    },
  },
  {
    files: ['./scripts/**/*.js', 'esbuild.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-restricted-syntax': 'off',
      'no-console': 'off',
      'no-empty': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Admin UI uses browser globals, not Node.js
    files: ['packages/admin-ui/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      // Allow default exports for React pages/components
      'import/no-default-export': 'off',
      // No restricted os imports for browser code
      'no-restricted-imports': 'off',
    },
  },
  {
    // Chat widget uses browser globals
    files: ['packages/chat-widget/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-default-export': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      'arrow-body-style': ['error', 'as-needed'],
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'default-case': 'error',
      'no-console': 'error',
    },
  },
  {
    // Chat widget product code: strict type assertions
    files: ['packages/chat-widget/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', 'packages/chat-widget/src/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
    },
  },
  {
    // Chat widget tests
    files: ['packages/chat-widget/src/**/*.test.{ts,tsx}'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/expect-expect': 'off',
      'vitest/no-commented-out-tests': 'off',
      'vitest/no-conditional-expect': 'off',
      'vitest/no-standalone-expect': 'off',
      'vitest/no-mocks-import': 'off',
    },
  },
  {
    // React SDK uses browser globals
    files: ['packages/react/src/**/*.{ts,tsx}', 'packages/react/test/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-default-export': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      'arrow-body-style': ['error', 'as-needed'],
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'default-case': 'error',
      'no-console': 'error',
    },
  },
  {
    // React SDK product code: strict type assertions
    files: ['packages/react/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
    },
  },
  {
    // React SDK tests
    files: ['packages/react/src/**/*.test.{ts,tsx}', 'packages/react/test/**/*.{ts,tsx}'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/expect-expect': 'off',
      'vitest/no-commented-out-tests': 'off',
      'vitest/no-conditional-expect': 'off',
      'vitest/no-standalone-expect': 'off',
      'vitest/no-mocks-import': 'off',
    },
  },
  {
    // Dashboard uses browser globals (Next.js app + components + hooks)
    files: ['packages/test-harness/surveillance/src/app/**/*.{ts,tsx}', 'packages/test-harness/surveillance/src/components/**/*.{ts,tsx}', 'packages/test-harness/surveillance/src/hooks/**/*.{ts,tsx}', 'packages/test-harness/surveillance/src/lib/config.ts', 'packages/test-harness/surveillance/src/lib/colors.ts', 'packages/test-harness/surveillance/src/lib/mapLayout.ts', 'packages/test-harness/surveillance/src/lib/utils.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-default-export': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      'arrow-body-style': ['error', 'as-needed'],
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'default-case': 'error',
      'no-console': 'error',
    },
  },
  {
    // Studio uses browser globals (Next.js app)
    files: ['packages/studio/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      'import/no-default-export': 'off',
      'no-restricted-imports': 'off',
    },
  },
  // Prettier config must be last
  prettierConfig,
  // extra settings for scripts that we run directly with node
  {
    files: ['./integration-tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
