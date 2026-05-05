/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Bundle the Studio Express server + lib into dist-server/.
 *
 * 1. esbuild bundles the server entry point into a single JS file
 * 2. tsc emits declaration files (.d.ts) for the lib modules so
 *    external consumers (e.g. cloud-studio) get type checking
 */

import { build } from 'esbuild';
import { execSync } from 'node:child_process';

// Bundle the library entry (no side effects on import).
await build({
  entryPoints: ['src/server/studio-server.ts'],
  outfile: 'dist-server/studio-server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
});

// Bundle the local-dev bin runner. Kept separate so importing the
// library never auto-binds a port or opens the PG LISTEN connection.
await build({
  entryPoints: ['src/server/bin.ts'],
  outfile: 'dist-server/bin.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
});

// Emit declaration files for the lib barrel into dist-server/
// so `import { ... } from '@amodalai/studio'` resolves types.
execSync('npx tsc --build tsconfig.build.json', { stdio: 'inherit' });
