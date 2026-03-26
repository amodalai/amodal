/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {listLockEntries} from '@amodalai/core';
import type {PackageType} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface ListOptions {
  cwd?: string;
  type?: PackageType;
  json?: boolean;
}

/**
 * List installed packages from the lock file.
 * Returns 0 on success, 1 on error.
 */
export async function runList(options: ListOptions = {}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[list] ${msg}\n`);
    return 1;
  }

  const entries = await listLockEntries(repoPath, options.type);

  if (entries.length === 0) {
    if (options.type) {
      process.stderr.write(`[list] No ${options.type} packages installed.\n`);
    } else {
      process.stderr.write('[list] No packages installed.\n');
    }
    return 0;
  }

  if (options.json) {
    const output = entries.map((e) => ({
      type: e.type,
      name: e.name,
      version: e.entry.version,
      npm: e.entry.npm,
      integrity: e.entry.integrity,
    }));
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return 0;
  }

  // Formatted table
  const typeWidth = Math.max(4, ...entries.map((e) => e.type.length));
  const nameWidth = Math.max(4, ...entries.map((e) => e.name.length));
  const versionWidth = Math.max(7, ...entries.map((e) => e.entry.version.length));

  const header = [
    'TYPE'.padEnd(typeWidth),
    'NAME'.padEnd(nameWidth),
    'VERSION'.padEnd(versionWidth),
    'NPM',
  ].join('   ');

  process.stdout.write(header + '\n');

  for (const e of entries) {
    const row = [
      e.type.padEnd(typeWidth),
      e.name.padEnd(nameWidth),
      e.entry.version.padEnd(versionWidth),
      e.entry.npm,
    ].join('   ');
    process.stdout.write(row + '\n');
  }

  process.stderr.write(`[list] ${entries.length} package${entries.length === 1 ? '' : 's'} installed.\n`);
  return 0;
}

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'List installed packages',
  builder: (yargs) =>
    yargs
      .option('type', {type: 'string', choices: ['connection', 'skill', 'automation', 'knowledge'] as const, describe: 'Filter by type'})
      .option('json', {type: 'boolean', default: false, describe: 'Output as JSON'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runList({type: argv['type'] as PackageType | undefined, json: argv['json'] as boolean});
    process.exit(code);
  },
};
