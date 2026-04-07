/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {
  pmRemove,
  removeAmodalPackage,
  toNpmName,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

/**
 * Uninstall a package via the detected package manager.
 * Returns 0 on success, 1 on error.
 */
export async function runUninstall(options: {cwd?: string; name: string}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[uninstall] ${msg}\n`);
    return 1;
  }

  const npmName = toNpmName(options.name);

  try {
    await pmRemove(repoPath, npmName);
    removeAmodalPackage(repoPath, npmName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[uninstall] Failed to remove ${npmName}: ${msg}\n`);
    return 1;
  }

  process.stderr.write(`[uninstall] Removed ${npmName}\n`);
  return 0;
}

export const uninstallCommand: CommandModule = {
  command: 'uninstall <name>',
  describe: 'Uninstall a package',
  builder: (yargs) =>
    yargs
      .positional('name', {type: 'string', demandOption: true, describe: 'Package name'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runUninstall({name: argv['name'] as string});
    process.exit(code);
  },
};
