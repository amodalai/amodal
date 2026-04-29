/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';

/**
 * Walks up from `startDir` (or cwd) looking for a directory containing
 * `amodal.json`. Throws if not found.
 */
export function findRepoRoot(startDir?: string): string {
  let dir = resolve(startDir ?? process.cwd());

  // Safety limit to prevent infinite loops
  const maxDepth = 100;
  let depth = 0;

  while (depth < maxDepth) {
    const configPath = join(dir, 'amodal.json');
    if (existsSync(configPath)) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      break;
    }
    dir = parent;
    depth++;
  }

  throw new Error(
    'Could not find amodal.json in any parent directory. ' +
    'Run `amodal init` to create a new project, or change to a directory containing an amodal.json file.',
  );
}

/**
 * Like `findRepoRoot`, but returns `{root, hasManifest}` instead of throwing
 * when no `amodal.json` is found. Used by `amodal dev` so the create flow
 * (Studio + admin agent) can run in an empty directory and scaffold the
 * project. The caller is responsible for skipping anything that needs a
 * loaded agent bundle (e.g. the runtime).
 */
export function findRepoRootOrCwd(
  startDir?: string,
): {root: string; hasManifest: boolean} {
  const cwd = resolve(startDir ?? process.cwd());
  try {
    return {root: findRepoRoot(cwd), hasManifest: true};
  } catch {
    return {root: cwd, hasManifest: false};
  }
}
