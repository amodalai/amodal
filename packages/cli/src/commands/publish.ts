/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import * as path from 'node:path';
import {promisify} from 'node:util';

import type {CommandModule} from 'yargs';
import {KNOWN_CONTENT_DIRS} from '@amodalai/core';

const execFileAsync = promisify(execFile);

const DEFAULT_REGISTRY = 'https://registry.amodalai.com';

export interface PublishOptions {
  cwd?: string;
  dryRun?: boolean;
  registry?: string;
}

/**
 * Publish a package to the registry.
 * Returns 0 on success, 1 on error.
 */
export async function runPublish(options: PublishOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const registry = options.registry ?? DEFAULT_REGISTRY;

  // Validate package.json exists
  const pkgJsonPath = path.join(cwd, 'package.json');
  let pkgName: string;
  let pkgVersion: string;
  let manifestName: string;

  try {
    const content = await readFile(pkgJsonPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config JSON
    const pkg = JSON.parse(content) as Record<string, unknown>;
    pkgName = String(pkg['name'] ?? '');
    pkgVersion = String(pkg['version'] ?? '');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const amodal = pkg['amodal'] as Record<string, unknown> | undefined;
    if (!amodal || typeof amodal !== 'object' || !amodal['name']) {
      process.stderr.write('[publish] package.json must have an "amodal" block with a "name" field.\n');
      return 1;
    }
    manifestName = String(amodal['name']);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[publish] Failed to read package.json: ${msg}\n`);
    return 1;
  }

  // Scan for known content directories and auto-populate `contains`
  const contains: string[] = [];
  for (const dir of KNOWN_CONTENT_DIRS) {
    try {
      const s = await stat(path.join(cwd, dir));
      if (s.isDirectory()) {
        const entries = await readdir(path.join(cwd, dir));
        if (entries.length > 0) contains.push(dir);
      }
    } catch {
      // Directory doesn't exist
    }
  }

  if (contains.length === 0) {
    process.stderr.write('[publish] Warning: no known amodal directories found (connections, skills, etc.).\n');
  }

  // Write `contains` into package.json before publishing
  try {
    const rawContent = await readFile(pkgJsonPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config JSON
    const pkgObj = JSON.parse(rawContent) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const amodal = pkgObj['amodal'] as Record<string, unknown>;
    amodal['contains'] = contains;
    await writeFile(pkgJsonPath, JSON.stringify(pkgObj, null, 2) + '\n', 'utf-8');
  } catch {
    // Non-fatal — publish will proceed without contains
  }

  if (options.dryRun) {
    process.stderr.write(`[publish] Dry run: would publish ${pkgName}@${pkgVersion}\n`);
    process.stderr.write(`[publish]   Name: ${manifestName}\n`);
    process.stderr.write(`[publish]   Contains: ${contains.length > 0 ? contains.join(', ') : '(none)'}\n`);
    process.stderr.write(`[publish]   Registry: ${registry}\n`);
    return 0;
  }

  process.stderr.write(`[publish] Publishing ${pkgName}@${pkgVersion} to ${registry}...\n`);

  try {
    await execFileAsync(
      'npm',
      ['publish', '--registry', registry],
      {
        cwd,
        timeout: 120_000,
      },
    );

    process.stderr.write(`[publish] Published ${pkgName}@${pkgVersion}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('403') || msg.includes('409') || msg.includes('EPUBLISHCONFLICT')) {
      process.stderr.write(`[publish] Version ${pkgVersion} already exists. Bump the version and try again.\n`);
    } else if (msg.includes('ENEEDAUTH') || msg.includes('E401')) {
      process.stderr.write(`[publish] Not authenticated. Run \`npm login --registry ${registry}\` first.\n`);
    } else {
      process.stderr.write(`[publish] Publish failed: ${msg}\n`);
    }
    return 1;
  }
}

export const publishCommand: CommandModule = {
  command: 'publish',
  describe: 'Publish a package to the registry',
  builder: (yargs) =>
    yargs
      .option('dry-run', {type: 'boolean', default: false, describe: 'Show what would be published'})
      .option('registry', {type: 'string', describe: 'Registry URL'}),
  handler: async (argv) => {
    const code = await runPublish({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      dryRun: argv['dryRun'] as boolean,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      registry: argv['registry'] as string | undefined,
    });
    process.exit(code);
  },
};
