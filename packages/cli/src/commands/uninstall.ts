/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {unlink, stat} from 'node:fs/promises';
import {join} from 'node:path';

import type {CommandModule} from 'yargs';
import {
  getLockEntry,
  getNpmContextPaths,
  makePackageRef,
  npmUninstall,
  removeConfigDep,
  removeLockEntry,
  toSymlinkName,
} from '@amodalai/core';
import type {PackageType} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface UninstallOptions {
  cwd?: string;
  type: PackageType;
  name: string;
}

/**
 * Uninstall a package: npm uninstall + remove lock entry + remove symlink.
 * Returns 0 on success, 1 on error.
 */
export async function runUninstall(options: UninstallOptions): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[uninstall] ${msg}\n`);
    return 1;
  }

  const entry = await getLockEntry(repoPath, options.type, options.name);
  if (!entry) {
    process.stderr.write(`[uninstall] ${options.type}/${options.name} is not installed.\n`);
    return 1;
  }

  const paths = getNpmContextPaths(repoPath);
  const ref = makePackageRef(options.type, options.name);

  try {
    await npmUninstall(paths, ref.npmName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[uninstall] npm uninstall failed: ${msg}\n`);
    return 1;
  }

  await removeLockEntry(repoPath, options.type, options.name);

  // Remove from amodal.json dependencies
  try {
    await removeConfigDep(repoPath, options.type, options.name);
  } catch {
    // Non-fatal — the dependency may not have been in amodal.json
  }

  // Remove symlink (ignore if already gone)
  const symlinkPath = join(paths.root, toSymlinkName(options.type, options.name));
  try {
    await unlink(symlinkPath);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      process.stderr.write(`[uninstall] Warning: could not remove symlink: ${symlinkPath}\n`);
    }
  }

  // Check for repo override directory
  const overrideDir = join(repoPath, `${options.type}s`, options.name);
  try {
    const s = await stat(overrideDir);
    if (s.isDirectory()) {
      process.stderr.write(`[uninstall] Note: local override directory still exists: ${overrideDir}\n`);
    }
  } catch {
    // No override dir — nothing to note
  }

  process.stderr.write(`[uninstall] Removed ${options.type}/${options.name}\n`);
  return 0;
}

export const uninstallCommand: CommandModule = {
  command: 'uninstall <type> <name>',
  describe: 'Uninstall a package',
  builder: (yargs) =>
    yargs
      .positional('type', {type: 'string', demandOption: true, choices: ['connection', 'skill', 'automation', 'knowledge'] as const, describe: 'Package type'})
      .positional('name', {type: 'string', demandOption: true, describe: 'Package name'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runUninstall({type: argv['type'] as PackageType, name: argv['name'] as string});
    process.exit(code);
  },
};
