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
import type {PackageType} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface SearchOptions {
  cwd?: string;
  query?: string;
  type?: PackageType;
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
  let query = options.type ? `@amodalai/${options.type}-` : '@amodalai/';
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

  // Further filter by type if specified
  if (options.type) {
    results = results.filter((r) => {
      try {
        const parsed = fromNpmName(r.name);
        return parsed.type === options.type;
      } catch {
        return false;
      }
    });
  }

  if (results.length === 0) {
    process.stderr.write('[search] No packages found.\n');
    return 0;
  }

  if (options.json) {
    const output = results.map((r) => {
      let type: string | undefined;
      let name: string | undefined;
      try {
        const parsed = fromNpmName(r.name);
        type = parsed.type;
        name = parsed.name;
      } catch {
        // Not a parseable amodal name
      }
      return {
        npm: r.name,
        version: r.version,
        description: r.description,
        type,
        name,
      };
    });
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return 0;
  }

  // Categorize results
  const grouped = new Map<string, Array<{name: string; version: string; description: string; npm: string}>>();
  for (const r of results) {
    let category = 'other';
    let pkgName = r.name;
    try {
      const parsed = fromNpmName(r.name);
      category = parsed.type;
      pkgName = parsed.name;
    } catch {
      // Not parseable
    }
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push({name: pkgName, version: r.version, description: r.description, npm: r.name});
  }

  for (const [category, items] of grouped) {
    process.stdout.write(`\n  ${category.toUpperCase()}\n`);
    const nameWidth = Math.max(4, ...items.map((i) => i.name.length));
    const versionWidth = Math.max(7, ...items.map((i) => i.version.length));
    for (const item of items) {
      process.stdout.write(`    ${item.name.padEnd(nameWidth)}   ${item.version.padEnd(versionWidth)}   ${item.description}\n`);
    }
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
      .option('type', {type: 'string', choices: ['connection', 'skill', 'automation', 'knowledge'] as const, describe: 'Filter by type'})
      .option('json', {type: 'boolean', default: false, describe: 'Output as JSON'}),
  handler: async (argv) => {
    const code = await runSearch({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      query: argv['query'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      type: argv['type'] as PackageType | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      json: argv['json'] as boolean,
    });
    process.exit(code);
  },
};
