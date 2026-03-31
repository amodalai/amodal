/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {
  buildLockFile,
  discoverInstalledPackages,
  ensureNpmContext,
  fromNpmName,
  npmInstall,
  npmViewVersions,
  readLockFile,
} from '@amodalai/core';
import * as semver from 'semver';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface UpdateOptions {
  cwd?: string;
  name?: string;
  latest?: boolean;
  dryRun?: boolean;
}

interface UpdateTarget {
  npmName: string;
  shortName: string;
  currentVersion: string;
}

/**
 * Update installed packages to newer versions.
 * Returns the number of failures (0 = success).
 */
export async function runUpdate(options: UpdateOptions = {}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[update] ${msg}\n`);
    return 1;
  }

  const paths = await ensureNpmContext(repoPath);

  const lockFile = await readLockFile(repoPath);
  if (!lockFile) {
    process.stderr.write('[update] No lock file found. Install packages first.\n');
    return 1;
  }

  // Build list of targets
  const targets: UpdateTarget[] = [];
  for (const [npmName, entry] of Object.entries(lockFile.packages)) {
    const shortName = fromNpmName(npmName);
    if (options.name && shortName !== options.name && npmName !== options.name) continue;
    targets.push({
      npmName,
      shortName,
      currentVersion: entry.version,
    });
  }

  if (targets.length === 0) {
    if (options.name) {
      process.stderr.write('[update] No matching packages found in lock file.\n');
    } else {
      process.stderr.write('[update] No packages installed.\n');
    }
    return 0;
  }

  // Check for updates
  const updates: Array<{target: UpdateTarget; newVersion: string}> = [];
  let failures = 0;

  for (const target of targets) {
    try {
      const versions = await npmViewVersions(paths, target.npmName);

      let newVersion: string | null;
      if (options.latest) {
        // Take the absolute latest
        newVersion = semver.maxSatisfying(versions, '*');
      } else {
        // Stay within current major (^current)
        newVersion = semver.maxSatisfying(versions, `^${target.currentVersion}`);
      }

      if (!newVersion || newVersion === target.currentVersion) {
        process.stderr.write(`[update] ${target.npmName}@${target.currentVersion} is already up to date.\n`);
        continue;
      }

      updates.push({target, newVersion});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[update] Failed to check ${target.npmName}: ${msg}\n`);
      failures++;
    }
  }

  if (updates.length === 0) {
    if (failures === 0) {
      process.stderr.write('[update] All packages are up to date.\n');
    }
    return failures;
  }

  // Print what will be updated
  if (options.dryRun) {
    process.stderr.write('[update] Dry run — the following would be updated:\n');
    for (const {target, newVersion} of updates) {
      process.stderr.write(`  ${target.npmName}: ${target.currentVersion} → ${newVersion}\n`);
    }
    return 0;
  }

  // Perform updates
  for (const {target, newVersion} of updates) {
    process.stderr.write(`[update] Updating ${target.npmName}: ${target.currentVersion} → ${newVersion}...\n`);
    try {
      const result = await npmInstall(paths, target.npmName, newVersion);
      process.stderr.write(`[update] Updated ${target.npmName}@${result.version}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[update] Failed to update ${target.npmName}: ${msg}\n`);
      failures++;
    }
  }

  // Rebuild lock file from what's actually installed
  const discovered = await discoverInstalledPackages(paths);
  await buildLockFile(repoPath, discovered);

  const successCount = updates.length - failures;
  if (failures > 0) {
    process.stderr.write(`[update] ${failures} of ${updates.length} update${updates.length === 1 ? '' : 's'} failed.\n`);
  } else {
    process.stderr.write(`[update] ${successCount} package${successCount === 1 ? '' : 's'} updated.\n`);
  }

  return failures;
}

export const updateCommand: CommandModule = {
  command: 'update [name]',
  describe: 'Update packages. Use --all for all packages, --admin-agent for the admin agent, or specify a name.',
  builder: (yargs) =>
    yargs
      .positional('name', {type: 'string', describe: 'Package name to update'})
      .option('all', {type: 'boolean', default: false, describe: 'Update all installed packages'})
      .option('admin-agent', {type: 'boolean', default: false, describe: 'Update the global admin agent cache'})
      .option('latest', {type: 'boolean', default: false, describe: 'Allow major version updates'})
      .option('dry-run', {type: 'boolean', default: false, describe: 'Show what would be updated'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const name = argv['name'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const all = argv['all'] as boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const adminAgent = argv['adminAgent'] as boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const latest = argv['latest'] as boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const dryRun = argv['dryRun'] as boolean;

    // Must specify at least one target
    if (!name && !all && !adminAgent) {
      process.stderr.write('Usage: amodal update <name> | --all | --admin-agent\n');
      process.stderr.write('  <name>          Update a specific package\n');
      process.stderr.write('  --all           Update all installed packages\n');
      process.stderr.write('  --admin-agent   Update the global admin agent\n');
      process.stderr.write('  Flags can be combined: amodal update --all --admin-agent\n');
      process.exit(1);
    }

    let failures = 0;

    // Update admin agent if requested
    if (adminAgent) {
      const {updateAdminAgentCommand} = await import('./admin.js');
      failures += await updateAdminAgentCommand();
    }

    // Update packages if requested
    if (name || all) {
      failures += await runUpdate({name, latest, dryRun});
    }

    process.exit(failures > 0 ? 1 : 0);
  },
};
