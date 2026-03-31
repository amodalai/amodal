/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {
  ensureNpmContext,
  fromNpmName,
  npmSearch,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface SearchOptions {
  cwd?: string;
  query?: string;
  tag?: string;
  json?: boolean;
}

/**
 * Search the registry for packages.
 * Returns 0 on success, 1 on error.
 */
export async function runSearch(options: SearchOptions = {}): Promise<number> {
  let repoPath: string | undefined;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch {
    // Not in a repo — use temp context
  }

  let paths;
  try {
    paths = await ensureNpmContext(repoPath ?? process.cwd());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[search] Failed to set up npm context: ${msg}\n`);
    return 1;
  }

  // Build query
  let query = '@amodalai/';
  if (options.tag) {
    query += `${options.tag}-`;
  }
  if (options.query) {
    query += options.query;
  }

  process.stderr.write(`[search] Searching for "${query}"...\n`);

  let results;
  try {
    results = await npmSearch(paths, query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[search] Search failed: ${msg}\n`);
    return 1;
  }

  // Filter to @amodalai/ packages only
  results = results.filter((r) => r.name.startsWith('@amodalai/'));

  // Filter by tag if specified (match against npm name prefix)
  if (options.tag) {
    const prefix = `@amodalai/${options.tag}-`;
    results = results.filter((r) => r.name.startsWith(prefix));
  }

  if (results.length === 0) {
    process.stderr.write('[search] No packages found.\n');
    return 0;
  }

  if (options.json) {
    const output = results.map((r) => ({
      npm: r.name,
      name: fromNpmName(r.name),
      version: r.version,
      description: r.description,
    }));
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return 0;
  }

  // Display results
  const nameWidth = Math.max(4, ...results.map((r) => fromNpmName(r.name).length));
  const versionWidth = Math.max(7, ...results.map((r) => r.version.length));

  for (const r of results) {
    const shortName = fromNpmName(r.name);
    process.stdout.write(`  ${shortName.padEnd(nameWidth)}   ${r.version.padEnd(versionWidth)}   ${r.description}\n`);
  }

  process.stderr.write(`\n[search] ${results.length} package${results.length === 1 ? '' : 's'} found.\n`);
  return 0;
}

export const searchCommand: CommandModule = {
  command: 'search [query]',
  describe: 'Search the registry for packages',
  builder: (yargs) =>
    yargs
      .positional('query', {type: 'string', describe: 'Search query'})
      .option('tag', {type: 'string', describe: 'Filter by tag prefix (e.g., connection, skill)'})
      .option('json', {type: 'boolean', default: false, describe: 'Output as JSON'}),
  handler: async (argv) => {
    const code = await runSearch({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      query: argv['query'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      tag: argv['tag'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      json: argv['json'] as boolean,
    });
    process.exit(code);
  },
};
