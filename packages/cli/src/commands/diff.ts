/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {join} from 'node:path';

import type {CommandModule} from 'yargs';
import {
  ensureNpmContext,
  fromNpmName,
  getLockEntry,
  getNpmContextPaths,
  npmView,
  readPackageFile,
  listPackageFiles,
  toNpmName,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface DiffOptions {
  cwd?: string;
  name: string;
}

/**
 * Show diff between installed version and latest available.
 * Returns 0 on success, 1 on error.
 */
export async function runDiff(options: DiffOptions): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[diff] ${msg}\n`);
    return 1;
  }

  const paths = await ensureNpmContext(repoPath);
  const npmName = toNpmName(options.name);
  const shortName = fromNpmName(npmName);

  // Check if installed
  const lockEntry = await getLockEntry(repoPath, npmName);
  if (!lockEntry) {
    process.stderr.write(`[diff] Package ${npmName} is not installed.\n`);
    return 1;
  }

  // Get latest version info
  let latestVersion: string;
  try {
    const viewResult = await npmView(paths, npmName);
    latestVersion = viewResult.version;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[diff] Failed to query registry: ${msg}\n`);
    return 1;
  }

  if (latestVersion === lockEntry.version) {
    process.stderr.write(`[diff] ${npmName}@${lockEntry.version} is already the latest version.\n`);
    return 0;
  }

  process.stderr.write(`[diff] Comparing ${npmName}: ${lockEntry.version} (installed) → ${latestVersion} (latest)\n`);

  // Get installed package directory
  const contextPaths = getNpmContextPaths(repoPath);
  const packageDir = join(contextPaths.nodeModules, npmName);

  // List installed files
  let installedFiles: string[];
  try {
    installedFiles = await listPackageFiles(packageDir);
  } catch {
    installedFiles = [];
  }

  // Print diff report
  process.stdout.write(`\n  ${npmName}\n`);
  process.stdout.write(`  Installed: ${lockEntry.version}\n`);
  process.stdout.write(`  Latest:    ${latestVersion}\n\n`);

  // Show file-level summary
  process.stdout.write('  Files in installed version:\n');
  for (const file of installedFiles) {
    const content = await readPackageFile(packageDir, file);
    if (content !== null) {
      const lineCount = content.split('\n').length;
      let detail = `${lineCount} lines`;

      // Add type-specific details
      if (file === 'surface.md') {
        const endpointCount = (content.match(/^##\s/gm) ?? []).length;
        detail += `, ${endpointCount} endpoint${endpointCount === 1 ? '' : 's'}`;
      } else if (file === 'spec.json') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const spec = JSON.parse(content) as Record<string, unknown>;
          const keys = Object.keys(spec);
          detail += `, keys: ${keys.join(', ')}`;
        } catch {
          // Not valid JSON
        }
      } else if (file === 'access.json') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const access = JSON.parse(content) as Record<string, unknown>;
          const ruleCount = Object.keys(access).length;
          detail += `, ${ruleCount} rule${ruleCount === 1 ? '' : 's'}`;
        } catch {
          // Not valid JSON
        }
      } else if (file === 'entities.md') {
        const sectionCount = (content.match(/^##\s/gm) ?? []).length;
        detail += `, ${sectionCount} entit${sectionCount === 1 ? 'y' : 'ies'}`;
      }

      process.stdout.write(`    ${file} (${detail})\n`);
    }
  }

  process.stdout.write(`\n  Run \`amodal update ${shortName}\` to upgrade.\n\n`);
  return 0;
}

export const diffCommand: CommandModule = {
  command: 'diff <name>',
  describe: 'Show diff between installed and latest version',
  builder: (yargs) =>
    yargs
      .positional('name', {type: 'string', demandOption: true, describe: 'Package name'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runDiff({name: argv['name'] as string});
    process.exit(code);
  },
};
