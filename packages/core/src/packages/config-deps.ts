/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, writeFile} from 'node:fs/promises';
import * as path from 'node:path';

import {PackageError} from './package-error.js';
import type {PackageType} from './package-types.js';
import {packageKey} from './package-types.js';

const CONFIG_FILENAME = 'amodal.json';

/**
 * Read the dependencies map from amodal.json.
 * Returns an empty record if no dependencies field exists.
 */
export async function readConfigDeps(repoPath: string): Promise<Record<string, string>> {
  const configPath = path.join(repoPath, CONFIG_FILENAME);
  let raw: Record<string, unknown>;
  try {
    const content = await readFile(configPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    throw new PackageError('LOCK_READ_FAILED', `Failed to read ${CONFIG_FILENAME}`, err);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (raw['dependencies'] as Record<string, string>) ?? {};
}

/**
 * Add or update a dependency in amodal.json.
 * Writes a caret range (^version) by default.
 */
export async function addConfigDep(
  repoPath: string,
  type: PackageType,
  name: string,
  version: string,
): Promise<void> {
  const configPath = path.join(repoPath, CONFIG_FILENAME);
  let raw: Record<string, unknown>;
  try {
    const content = await readFile(configPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    throw new PackageError('LOCK_WRITE_FAILED', `Failed to read ${CONFIG_FILENAME}`, err);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const deps = (raw['dependencies'] as Record<string, string>) ?? {};
  const key = packageKey(type, name);
  deps[key] = `^${version}`;
  raw['dependencies'] = deps;

  await writeFile(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
}

/**
 * Remove a dependency from amodal.json.
 */
export async function removeConfigDep(
  repoPath: string,
  type: PackageType,
  name: string,
): Promise<void> {
  const configPath = path.join(repoPath, CONFIG_FILENAME);
  let raw: Record<string, unknown>;
  try {
    const content = await readFile(configPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    throw new PackageError('LOCK_WRITE_FAILED', `Failed to read ${CONFIG_FILENAME}`, err);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const deps = (raw['dependencies'] as Record<string, string>) ?? {};
  const key = packageKey(type, name);
  delete deps[key];

  if (Object.keys(deps).length > 0) {
    raw['dependencies'] = deps;
  } else {
    delete raw['dependencies'];
  }

  await writeFile(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
}
