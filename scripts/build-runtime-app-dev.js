/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Build the runtime-app dev middleware to JS.
 * This compiles create-dev-middleware.ts and vite-plugin-amodal.ts
 * so they can be imported at runtime from the published npm package.
 */

import {execSync} from 'node:child_process';
import {mkdirSync, existsSync} from 'node:fs';
import path from 'node:path';

const runtimeAppDir = path.resolve(import.meta.dirname, '..', 'packages', 'runtime-app');
const outDir = path.join(runtimeAppDir, 'dist-dev');

if (!existsSync(outDir)) {
  mkdirSync(outDir, {recursive: true});
}

// Use tsc to compile just the dev-related files
execSync(
  `npx tsc --outDir "${outDir}" --declaration --module nodenext --moduleResolution nodenext --target es2022 --esModuleInterop --skipLibCheck src/create-dev-middleware.ts src/vite-plugin-amodal.ts`,
  {cwd: runtimeAppDir, stdio: 'inherit'},
);

console.log('[build] Runtime app dev middleware compiled to dist-dev/');
