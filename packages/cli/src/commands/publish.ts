/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import * as path from 'node:path';
import {promisify} from 'node:util';

import type {CommandModule} from 'yargs';
import {readPackageManifest} from '@amodalai/core';

const execFileAsync = promisify(execFile);

const DEFAULT_REGISTRY = 'https://registry.amodalai.com';

export interface PublishOptions {
  cwd?: string;
  dryRun?: boolean;
  registry?: string;
}

const REQUIRED_FILES: Record<string, string[]> = {
  connection: ['spec.json', 'surface.md'],
  skill: ['SKILL.md'],
  automation: [],
  knowledge: [],
  mcp: [],
};

/**
 * Publish a package to the registry.
 * Returns 0 on success, 1 on error.
 */
export async function runPublish(options: PublishOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const registry = options.registry ?? DEFAULT_REGISTRY;

  // Validate package.json exists
  const pkgJsonPath = path.join(cwd, 'package.json');
  try {
    await stat(pkgJsonPath);
  } catch {
    process.stderr.write('[publish] No package.json found in current directory.\n');
    return 1;
  }

  // Read and validate manifest
  let manifest;
  try {
    manifest = await readPackageManifest(cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[publish] Invalid package: ${msg}\n`);
    return 1;
  }

  // Check required files
  const required = REQUIRED_FILES[manifest.type] ?? [];
  const missingFiles: string[] = [];
  for (const file of required) {
    try {
      await stat(path.join(cwd, file));
    } catch {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length > 0) {
    process.stderr.write(`[publish] Missing required files: ${missingFiles.join(', ')}\n`);
    return 1;
  }

  // Read package name and version
  let pkgName: string;
  let pkgVersion: string;
  try {
    const content = await readFile(pkgJsonPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const pkg = JSON.parse(content) as Record<string, unknown>;
    pkgName = String(pkg['name'] ?? '');
    pkgVersion = String(pkg['version'] ?? '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[publish] Failed to read package.json: ${msg}\n`);
    return 1;
  }

  if (options.dryRun) {
    process.stderr.write(`[publish] Dry run: would publish ${pkgName}@${pkgVersion}\n`);
    process.stderr.write(`[publish]   Type: ${manifest.type}\n`);
    process.stderr.write(`[publish]   Name: ${manifest.name}\n`);
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
