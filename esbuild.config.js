/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { wasmLoader } from 'esbuild-plugin-wasm';

let esbuild;
try {
  esbuild = (await import('esbuild')).default;
} catch (_error) {
  console.error('esbuild not available — cannot build bundle');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(path.resolve(__dirname, 'package.json'));

// ---------------------------------------------------------------------------
// WASM plugin — handles .wasm?binary imports (tree-sitter, etc.)
// ---------------------------------------------------------------------------

function createWasmPlugins() {
  const wasmBinaryPlugin = {
    name: 'wasm-binary',
    setup(build) {
      build.onResolve({ filter: /\.wasm\?binary$/ }, (args) => {
        const specifier = args.path.replace(/\?binary$/, '');
        const resolveDir = args.resolveDir || '';
        const isBareSpecifier =
          !path.isAbsolute(specifier) &&
          !specifier.startsWith('./') &&
          !specifier.startsWith('../');

        let resolvedPath;
        if (isBareSpecifier) {
          resolvedPath = require.resolve(specifier, {
            paths: resolveDir ? [resolveDir, __dirname] : [__dirname],
          });
        } else {
          resolvedPath = path.isAbsolute(specifier)
            ? specifier
            : path.join(resolveDir, specifier);
        }

        return { path: resolvedPath, namespace: 'wasm-embedded' };
      });
    },
  };

  // Stub out react-devtools-core — ink imports it statically but it's dev-only
  const devtoolsStubPlugin = {
    name: 'devtools-stub',
    setup(build) {
      build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
        path: 'react-devtools-core',
        namespace: 'devtools-stub',
      }));
      build.onLoad(
        { filter: /.*/, namespace: 'devtools-stub' },
        () => ({ contents: 'export default undefined;', loader: 'js' }),
      );
    },
  };

  return [wasmBinaryPlugin, devtoolsStubPlugin, wasmLoader({ mode: 'embedded' })];
}

// ---------------------------------------------------------------------------
// Externals — native addons, WASM-heavy packages, dev-only deps
// ---------------------------------------------------------------------------

const external = [
  // Native addons
  '@lydell/node-pty',
  'node-pty',
  '@lydell/node-pty-darwin-arm64',
  '@lydell/node-pty-darwin-x64',
  '@lydell/node-pty-linux-x64',
  '@lydell/node-pty-win32-arm64',
  '@lydell/node-pty-win32-x64',
  'keytar',
  // PGlite uses WASM — keep external and let Node resolve at runtime
  '@electric-sql/pglite',
  // Vite is only needed in dev mode, not in the production bundle
  'vite',
  '@vitejs/plugin-react',
  // Runtime-app dev middleware (only used in dev, not bundled)
  '@amodalai/runtime-app/dev',
];

mkdirSync('bundle', { recursive: true });

// ---------------------------------------------------------------------------
// Bundle config
// ---------------------------------------------------------------------------

const cliConfig = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  loader: { '.node': 'file' },
  write: true,
  banner: {
    js: [
      `const require = (await import('module')).createRequire(import.meta.url);`,
      `globalThis.__filename = require('url').fileURLToPath(import.meta.url);`,
      `globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
      // Suppress Node.js DEP0040 punycode deprecation from dependencies
      `const _origEmit = process.emitWarning;`,
      `process.emitWarning = (w, ...a) => { if (typeof w === 'string' && w.includes('punycode')) return; return _origEmit.call(process, w, ...a); };`,
    ].join(' '),
  },
  entryPoints: ['packages/cli/src/main.ts'],
  outfile: 'bundle/amodal.js',
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
  },
  plugins: createWasmPlugins(),
  metafile: true,
  // Resolve workspace packages from source
  alias: {
    '@amodalai/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
    '@amodalai/runtime': path.resolve(__dirname, 'packages/runtime/src/index.ts'),
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

esbuild
  .build(cliConfig)
  .then(({ metafile }) => {
    if (process.env.DEV === 'true') {
      writeFileSync('./bundle/esbuild.json', JSON.stringify(metafile, null, 2));
    }
    const outBytes = Object.values(metafile.outputs).reduce(
      (sum, o) => sum + o.bytes,
      0,
    );
    chmodSync('./bundle/amodal.js', 0o755);
    console.log(
      `✓ bundle/amodal.js — ${(outBytes / 1024 / 1024).toFixed(1)} MB`,
    );
  })
  .catch((err) => {
    console.error('Bundle failed:', err);
    process.exit(1);
  });
