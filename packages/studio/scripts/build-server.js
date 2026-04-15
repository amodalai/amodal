/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Bundle the Studio Express server into a single file using esbuild.
 * Output: dist-server/studio-server.js
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/studio-server.ts'],
  outfile: 'dist-server/studio-server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // Keep runtime deps external — they'll be in node_modules
  packages: 'external',
  // Let the source code handle __dirname/require via its own imports
});

console.log('Studio server bundled to dist-server/studio-server.js');
