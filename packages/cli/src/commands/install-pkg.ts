/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import type {CommandModule} from 'yargs';
import {
  ensurePackageJson,
  addAmodalPackage,
  pmAdd,
  pmInstall,
  toNpmName,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

/**
 * Install one or more packages, or run a bare install.
 * Returns the number of failures (0 = success).
 *
 * Usage:
 *   amodal install                          — run package manager install
 *   amodal install alert-enrichment         — add @amodalai/alert-enrichment
 *   amodal install @amodalai/soc-agent      — add with full npm name
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

  // Read project name from amodal.json for ensurePackageJson
  let projectName = 'amodal-project';
  try {
    const configRaw = readFileSync(path.join(repoPath, 'amodal.json'), 'utf-8');
    const config: unknown = JSON.parse(configRaw);
    if (config && typeof config === 'object' && 'name' in config) {
      projectName = String((config as Record<string, unknown>)['name']);
    }
  } catch {
    // Use default project name
  }

  ensurePackageJson(repoPath, projectName);

  // Bare install: run package manager install
  if (!options.packages || options.packages.length === 0) {
    process.stderr.write('[install] Running package manager install...\n');
    try {
      await pmInstall(repoPath);
      process.stderr.write('[install] Done.\n');
      return 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[install] Install failed: ${msg}\n`);
      return 1;
    }
  }

  // Install specific packages
  let failures = 0;
  for (const name of options.packages) {
    const npmName = toNpmName(name);
    process.stderr.write(`[install] Adding ${npmName}...\n`);
    try {
      await pmAdd(repoPath, npmName);
      addAmodalPackage(repoPath, npmName);
      process.stderr.write(`[install] Added ${npmName}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[install] Failed: ${npmName}: ${msg}\n`);
      failures++;
    }
  }

  if (failures > 0) {
    process.stderr.write(`[install] ${failures} package(s) failed.\n`);
  } else {
    process.stderr.write(`[install] ${options.packages.length} package(s) added.\n`);
  }

  return failures;
}

export const installPkgCommand: CommandModule = {
  command: 'install [packages..]',
  describe: 'Install packages (or run bare install)',
  builder: (yargs) =>
    yargs.positional('packages', {type: 'string', array: true, describe: 'Package names to install'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const raw = (argv['packages'] as string[] | undefined) ?? [];
    const code = await runInstallPkg({packages: raw.length > 0 ? raw : undefined});
    process.exit(code);
  },
};
