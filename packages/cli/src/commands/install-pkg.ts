/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import type {CommandModule} from 'yargs';
import {
  addConfigDep,
  addLockEntry,
  ensureNpmContext,
  ensureSymlink,
  makePackageRef,
  npmInstall,
  parsePackageKey,
  readConfigDeps,
  readLockFile,
  readPackageManifest,
  getPackageDir,
} from '@amodalai/core';
import type {PackageType} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

const VALID_TYPES = new Set<string>(['connection', 'skill', 'automation', 'knowledge', 'mcp']);

/**
 * Parse variadic install args: `connection salesforce skill triage` → [{type, name}]
 */
export function parseInstallArgs(args: string[]): Array<{type: PackageType; name: string}> {
  const result: Array<{type: PackageType; name: string}> = [];
  for (let i = 0; i < args.length; i += 2) {
    const rawType = args[i];
    const name = args[i + 1];
    if (!rawType || !name) {
      throw new Error(`Invalid install arguments: expected pairs of <type> <name>, got incomplete pair at position ${i}`);
    }
    if (!VALID_TYPES.has(rawType)) {
      throw new Error(`Invalid package type "${rawType}". Valid types: ${[...VALID_TYPES].join(', ')}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    result.push({type: rawType as PackageType, name});
  }
  return result;
}

export interface InstallPkgOptions {
  cwd?: string;
  packages?: Array<{type: PackageType; name: string; version?: string}>;
}

/**
 * Install one or more packages, or restore all from lock file.
 * Returns the number of failures (0 = success).
 */
export async function runInstallPkg(options: InstallPkgOptions = {}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[install] ${msg}\n`);
    return 1;
  }

  const paths = await ensureNpmContext(repoPath);

  // Bare install: restore from lock file, or install from amodal.json dependencies
  if (!options.packages || options.packages.length === 0) {
    const lockFile = await readLockFile(repoPath);

    if (lockFile && Object.keys(lockFile.packages).length > 0) {
      // Lock file exists — install each package at its pinned version
      const entryCount = Object.keys(lockFile.packages).length;
      process.stderr.write(`[install] Restoring ${entryCount} package${entryCount === 1 ? '' : 's'} from lock file...\n`);
      let failures = 0;
      for (const [key, entry] of Object.entries(lockFile.packages)) {
        const {type, name} = parsePackageKey(key);
        const ref = makePackageRef(type, name);
        try {
          await npmInstall(paths, ref.npmName, entry.version);
          await ensureSymlink(paths, ref);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[install] Failed to restore ${ref.npmName}@${entry.version}: ${msg}\n`);
          failures++;
        }
      }
      if (failures > 0) {
        process.stderr.write(`[install] ${failures} of ${entryCount} packages failed to restore.\n`);
        return failures;
      }
      process.stderr.write(`[install] Restored ${entryCount} package${entryCount === 1 ? '' : 's'}.\n`);
      return 0;
    }

    // No lock file — check amodal.json dependencies (fresh clone)
    let deps: Record<string, string>;
    try {
      deps = await readConfigDeps(repoPath);
    } catch {
      deps = {};
    }

    if (Object.keys(deps).length === 0) {
      process.stderr.write('[install] Nothing to install. No dependencies in amodal.json and no lock file found.\n');
      return 0;
    }

    // Install each dependency from amodal.json
    process.stderr.write(`[install] Installing ${Object.keys(deps).length} package${Object.keys(deps).length === 1 ? '' : 's'} from amodal.json...\n`);
    let failures = 0;
    for (const [key, versionRange] of Object.entries(deps)) {
      const {type, name} = parsePackageKey(key);
      const ref = makePackageRef(type, name);
      process.stderr.write(`[install] Installing ${ref.npmName}@${versionRange}...\n`);
      try {
        const result = await npmInstall(paths, ref.npmName, versionRange);
        await addLockEntry(repoPath, type, name, {
          version: result.version,
          npm: ref.npmName,
          integrity: result.integrity,
        });
        await ensureSymlink(paths, ref);
        process.stderr.write(`[install] Installed ${ref.npmName}@${result.version}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[install] Failed to install ${ref.npmName}: ${msg}\n`);
        failures++;
      }
    }
    return failures;
  }

  // Install specific packages
  let failures = 0;

  for (const pkg of options.packages) {
    const ref = makePackageRef(pkg.type, pkg.name);
    const versionLabel = pkg.version ? `@${pkg.version}` : '';
    process.stderr.write(`[install] Installing ${ref.npmName}${versionLabel}...\n`);

    try {
      const result = await npmInstall(paths, ref.npmName, pkg.version);
      await addLockEntry(repoPath, pkg.type, pkg.name, {
        version: result.version,
        npm: ref.npmName,
        integrity: result.integrity,
      });
      await ensureSymlink(paths, ref);

      // Add to amodal.json dependencies
      await addConfigDep(repoPath, pkg.type, pkg.name, result.version);

      // MCP packages: merge server config into amodal.json
      if (pkg.type === 'mcp') {
        await mergeMcpConfig(repoPath, ref.key, pkg.name);
      }

      process.stderr.write(`[install] Installed ${ref.npmName}@${result.version}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[install] Failed to install ${ref.npmName}: ${msg}\n`);
      failures++;
    }
  }

  if (failures > 0) {
    process.stderr.write(`[install] ${failures} of ${options.packages.length} package${options.packages.length === 1 ? '' : 's'} failed.\n`);
  } else {
    process.stderr.write(`[install] ${options.packages.length} package${options.packages.length === 1 ? '' : 's'} installed successfully.\n`);
  }

  return failures;
}

/**
 * After installing an MCP package, read its manifest and merge
 * the server config into amodal.json's mcp.servers block.
 */
async function mergeMcpConfig(repoPath: string, packageKey: string, name: string): Promise<void> {
  const ref = makePackageRef('mcp', name);
  const pkgDir = await getPackageDir(repoPath, ref);
  if (!pkgDir) return;

  const manifest = await readPackageManifest(pkgDir);
  if (manifest.type !== 'mcp') return;

  // Read current amodal.json
  const configPath = path.join(repoPath, 'amodal.json');
  const raw = await readFile(configPath, 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config JSON
  const config = JSON.parse(raw) as Record<string, unknown>;

  // Ensure mcp.servers exists
  if (!config['mcp'] || typeof config['mcp'] !== 'object') {
    config['mcp'] = {};
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
  const mcp = config['mcp'] as Record<string, unknown>;
  if (!mcp['servers'] || typeof mcp['servers'] !== 'object') {
    mcp['servers'] = {};
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
  const servers = mcp['servers'] as Record<string, unknown>;

  // Build server entry from manifest
  const entry: Record<string, unknown> = {transport: manifest.transport};
  if (manifest.url) entry['url'] = manifest.url;
  if (manifest.command) entry['command'] = manifest.command;
  if (manifest.args) entry['args'] = manifest.args;
  if (manifest.env) entry['env'] = manifest.env;
  if (manifest.trust) entry['trust'] = manifest.trust;

  servers[name] = entry;

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  process.stderr.write(`[install] Added MCP server "${name}" to amodal.json\n`);
}

export const installPkgCommand: CommandModule = {
  command: 'install [packages..]',
  describe: 'Install packages (or restore all from lock file)',
  builder: (yargs) =>
    yargs.positional('packages', {type: 'string', array: true, describe: 'Pairs of <type> <name>'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const raw = (argv['packages'] as string[] | undefined) ?? [];
    const packages = raw.length > 0 ? parseInstallArgs(raw) : undefined;
    const code = await runInstallPkg({packages});
    process.exit(code);
  },
};
