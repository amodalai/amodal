/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {
  addConfigDep,
  buildLockFile,
  discoverInstalledPackages,
  ensureNpmContext,
  npmInstall,
  readConfigDeps,
  readLockFile,
  toNpmName,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

/**
 * Install one or more packages, or restore all from lock file.
 * Returns the number of failures (0 = success).
 *
 * Usage:
 *   amodal install                          — restore from lock file or amodal.json deps
 *   amodal install alert-enrichment         — install @amodalai/alert-enrichment + transitive deps
 *   amodal install @amodalai/soc-agent      — install with full npm name
 */
export async function runInstallPkg(options: {cwd?: string; packages?: string[]} = {}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[install] ${msg}\n`);
    return 1;
  }

  const paths = await ensureNpmContext(repoPath);

  // Bare install: restore from lock file or amodal.json dependencies
  if (!options.packages || options.packages.length === 0) {
    const lockFile = await readLockFile(repoPath);

    if (lockFile && Object.keys(lockFile.packages).length > 0) {
      const entries = Object.entries(lockFile.packages);
      process.stderr.write(`[install] Restoring ${entries.length} package(s) from lock file...\n`);
      let failures = 0;
      for (const [npmName, entry] of entries) {
        try {
          await npmInstall(paths, npmName, entry.version);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[install] Failed: ${npmName}@${entry.version}: ${msg}\n`);
          failures++;
        }
      }
      if (failures > 0) {
        process.stderr.write(`[install] ${failures} package(s) failed.\n`);
        return failures;
      }
      process.stderr.write(`[install] Restored ${entries.length} package(s).\n`);
      return 0;
    }

    // No lock file — check amodal.json dependencies
    let deps: Record<string, string>;
    try {
      deps = await readConfigDeps(repoPath);
    } catch {
      deps = {};
    }

    if (Object.keys(deps).length === 0) {
      process.stderr.write('[install] Nothing to install.\n');
      return 0;
    }

    process.stderr.write(`[install] Installing ${Object.keys(deps).length} package(s) from amodal.json...\n`);
    let failures = 0;
    for (const [name, versionRange] of Object.entries(deps)) {
      const npmName = toNpmName(name);
      try {
        await npmInstall(paths, npmName, versionRange);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[install] Failed: ${npmName}@${versionRange}: ${msg}\n`);
        failures++;
      }
    }

    // Rebuild lock file from what's actually installed
    const discovered = await discoverInstalledPackages(paths);
    await buildLockFile(repoPath, discovered);
    process.stderr.write(`[install] ${discovered.length} package(s) installed.\n`);
    return failures;
  }

  // Install specific packages
  let failures = 0;
  for (const name of options.packages) {
    const npmName = toNpmName(name);
    process.stderr.write(`[install] Installing ${npmName}...\n`);
    try {
      await npmInstall(paths, npmName);
      process.stderr.write(`[install] Installed ${npmName}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[install] Failed: ${npmName}: ${msg}\n`);
      failures++;
    }
  }

  // Discover everything installed (including transitive deps) and rebuild lock file
  const discovered = await discoverInstalledPackages(paths);
  await buildLockFile(repoPath, discovered);

  // Add direct installs to amodal.json dependencies
  for (const name of options.packages) {
    const npmName = toNpmName(name);
    const installed = discovered.find((d) => d.npmName === npmName);
    if (installed) {
      try {
        await addConfigDep(repoPath, npmName, installed.version);
      } catch {
        // amodal.json might not exist yet
      }
    }
  }

  if (failures > 0) {
    process.stderr.write(`[install] ${failures} package(s) failed.\n`);
  } else {
    process.stderr.write(`[install] ${discovered.length} total package(s) (including dependencies).\n`);
  }

  return failures;
}

export const installPkgCommand: CommandModule = {
  command: 'install [packages..]',
  describe: 'Install packages (or restore all from lock file)',
  builder: (yargs) =>
    yargs.positional('packages', {type: 'string', array: true, describe: 'Package names to install'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const raw = (argv['packages'] as string[] | undefined) ?? [];
    const code = await runInstallPkg({packages: raw.length > 0 ? raw : undefined});
    process.exit(code);
  },
};
