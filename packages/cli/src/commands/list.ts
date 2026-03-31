/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {fromNpmName, listLockEntries} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface ListOptions {
  cwd?: string;
  filter?: string;
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

  let entries = await listLockEntries(repoPath);

  // Optional string filter on npm name
  if (options.filter) {
    const f = options.filter.toLowerCase();
    entries = entries.filter((e) => e.npmName.toLowerCase().includes(f));
  }

  if (entries.length === 0) {
    if (options.filter) {
      process.stderr.write(`[list] No packages matching "${options.filter}" installed.\n`);
    } else {
      process.stderr.write('[list] No packages installed.\n');
    }
    return 0;
  }

  if (options.json) {
    const output = entries.map((e) => ({
      name: fromNpmName(e.npmName),
      npmName: e.npmName,
      version: e.entry.version,
      integrity: e.entry.integrity,
    }));
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return 0;
  }

  // Formatted table
  const names = entries.map((e) => fromNpmName(e.npmName));
  const nameWidth = Math.max(4, ...names.map((n) => n.length));
  const npmWidth = Math.max(3, ...entries.map((e) => e.npmName.length));
  const versionWidth = Math.max(7, ...entries.map((e) => e.entry.version.length));

  const header = [
    'NAME'.padEnd(nameWidth),
    'VERSION'.padEnd(versionWidth),
    'NPM'.padEnd(npmWidth),
  ].join('   ');

  process.stdout.write(header + '\n');

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const row = [
      names[i].padEnd(nameWidth),
      e.entry.version.padEnd(versionWidth),
      e.npmName.padEnd(npmWidth),
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
      .option('filter', {type: 'string', describe: 'Filter by name substring'})
      .option('json', {type: 'boolean', default: false, describe: 'Output as JSON'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runList({filter: argv['filter'] as string | undefined, json: argv['json'] as boolean});
    process.exit(code);
  },
};
