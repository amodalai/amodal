/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import type {CommandModule} from 'yargs';
import {
  buildLockFile,
  discoverInstalledPackages,
  ensureNpmContext,
  getNpmContextPaths,
  npmUninstall,
  toNpmName,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

/**
 * Uninstall a package: npm uninstall + rebuild lock file.
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
  const paths = getNpmContextPaths(repoPath);

  try {
    await npmUninstall(paths, npmName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[uninstall] npm uninstall failed: ${msg}\n`);
    return 1;
  }

  // Rebuild lock file from remaining packages
  await ensureNpmContext(repoPath);
  const discovered = await discoverInstalledPackages(paths);
  await buildLockFile(repoPath, discovered);

  // Remove from amodal.json dependencies
  try {
    const configPath = path.join(repoPath, 'amodal.json');
    const configRaw = await readFile(configPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config JSON
    const config = JSON.parse(configRaw) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const deps = (config['dependencies'] as Record<string, string>) ?? {};
    delete deps[npmName];
    if (Object.keys(deps).length > 0) {
      config['dependencies'] = deps;
    } else {
      delete config['dependencies'];
    }
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch {
    // Non-fatal
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
