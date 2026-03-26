/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir} from 'node:fs/promises';
import * as path from 'node:path';
import {ZodError} from 'zod';

import {PackageError} from './package-error.js';
import {PackageManifestSchema} from './package-types.js';
import type {PackageManifest} from './package-types.js';

/**
 * Read and validate the amodal manifest from an installed package directory.
 */
export async function readPackageManifest(packageDir: string): Promise<PackageManifest> {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  let content: string;
  try {
    content = await readFile(pkgJsonPath, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PackageError('NOT_FOUND', `Missing package.json in ${packageDir}`);
    }
    throw new PackageError('PARSE_FAILED', `Failed to read ${pkgJsonPath}`, err);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new PackageError('PARSE_FAILED', `Invalid JSON in ${pkgJsonPath}`, err);
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PackageError('PARSE_FAILED', `package.json is not an object in ${packageDir}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const pkg = raw as Record<string, unknown>;
  const amodal = pkg['amodal'];

  if (!amodal || typeof amodal !== 'object') {
    throw new PackageError(
      'VALIDATION_FAILED',
      `Missing or invalid "amodal" block in ${pkgJsonPath}`,
    );
  }

  try {
    return PackageManifestSchema.parse(amodal);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new PackageError(
        'VALIDATION_FAILED',
        `Invalid amodal manifest in ${pkgJsonPath}: ${issues}`,
        err,
      );
    }
    throw new PackageError('VALIDATION_FAILED', `Manifest validation failed in ${packageDir}`, err);
  }
}

/**
 * Read a specific file from a package directory.
 * Returns null if the file doesn't exist.
 */
export async function readPackageFile(
  packageDir: string,
  filename: string,
): Promise<string | null> {
  const filePath = path.join(packageDir, filename);
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new PackageError('NOT_FOUND', `Failed to read ${filePath}`, err);
  }
}

/**
 * List all files in a package directory.
 */
export async function listPackageFiles(packageDir: string): Promise<string[]> {
  try {
    const entries = await readdir(packageDir, {withFileTypes: true});
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new PackageError('NOT_FOUND', `Failed to list files in ${packageDir}`, err);
  }
}
