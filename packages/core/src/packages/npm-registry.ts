/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

import {PackageError} from './package-error.js';
import type {NpmContextPaths} from './npm-context.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 120_000;

/**
 * Result from `npm view`.
 */
export interface NpmViewResult {
  name: string;
  version: string;
  versions: string[];
  description?: string;
}

/**
 * Result from `npm search`.
 */
export interface NpmSearchResult {
  name: string;
  version: string;
  description: string;
}

/**
 * Run `npm view <pkg> --json` and parse the result.
 */
export async function npmView(
  paths: NpmContextPaths,
  npmName: string,
  timeout?: number,
): Promise<NpmViewResult> {
  try {
    const {stdout} = await execFileAsync(
      'npm',
      ['view', npmName, '--json'],
      {
        cwd: paths.npmDir,
        timeout: timeout ?? DEFAULT_TIMEOUT,
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new PackageError('NPM_INSTALL_FAILED', `Failed to parse npm view output for ${npmName}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const result = parsed as Record<string, unknown>;
    return {
      name: String(result['name'] ?? npmName),
      version: String(result['version'] ?? ''),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      versions: Array.isArray(result['versions']) ? (result['versions'] as string[]) : [],
      description: result['description'] ? String(result['description']) : undefined,
    };
  } catch (err) {
    if (err instanceof PackageError) throw err;
    throw new PackageError('NPM_INSTALL_FAILED', `Failed to view ${npmName}`, err);
  }
}

/**
 * Run `npm search <query> --json` and parse the result.
 */
export async function npmSearch(
  paths: NpmContextPaths,
  query: string,
  timeout?: number,
): Promise<NpmSearchResult[]> {
  try {
    const {stdout} = await execFileAsync(
      'npm',
      ['search', query, '--json'],
      {
        cwd: paths.npmDir,
        timeout: timeout ?? DEFAULT_TIMEOUT,
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new PackageError('NPM_INSTALL_FAILED', `Failed to parse npm search output for "${query}"`);
    }

    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const entry = item as Record<string, unknown>;
      return {
        name: String(entry['name'] ?? ''),
        version: String(entry['version'] ?? ''),
        description: String(entry['description'] ?? ''),
      };
    });
  } catch (err) {
    if (err instanceof PackageError) throw err;
    throw new PackageError('NPM_INSTALL_FAILED', `Failed to search for "${query}"`, err);
  }
}

/**
 * Run `npm view <pkg> versions --json` to get all available versions.
 */
export async function npmViewVersions(
  paths: NpmContextPaths,
  npmName: string,
  timeout?: number,
): Promise<string[]> {
  try {
    const {stdout} = await execFileAsync(
      'npm',
      ['view', npmName, 'versions', '--json'],
      {
        cwd: paths.npmDir,
        timeout: timeout ?? DEFAULT_TIMEOUT,
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new PackageError('NPM_INSTALL_FAILED', `Failed to parse npm view versions output for ${npmName}`);
    }

    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v));
    }

    // Single version returns a string, not an array
    if (typeof parsed === 'string') return [parsed];

    return [];
  } catch (err) {
    if (err instanceof PackageError) throw err;
    throw new PackageError('NPM_INSTALL_FAILED', `Failed to view versions for ${npmName}`, err);
  }
}
