/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir} from 'node:fs/promises';
import * as path from 'node:path';

import type {LoadedStore} from './store-types.js';
import {StoreJsonSchema, STORE_NAME_REGEX} from './store-schemas.js';
import {RepoError} from './repo-types.js';

/**
 * List .json files in a directory. Returns [] if dir doesn't exist.
 */
async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, {withFileTypes: true});
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Parse a store JSON string into a LoadedStore.
 */
export function parseStoreJson(
  jsonString: string,
  fileName: string,
  location: string,
): LoadedStore {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new RepoError(
      'CONFIG_PARSE_FAILED',
      `Invalid JSON in store file "${fileName}"`,
      err,
    );
  }

  const parsed = StoreJsonSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Invalid store definition "${fileName}": ${issues}`,
    );
  }

  const storeJson = parsed.data;
  const name = storeJson.name ?? fileName.replace(/\.json$/, '');

  // Validate name derived from filename
  if (!storeJson.name && !STORE_NAME_REGEX.test(name)) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Store filename "${fileName}" is not a valid store name. ` +
      'Store names must be kebab-case (lowercase letters, digits, hyphens), starting with a letter.',
    );
  }

  // If name is provided, verify it matches filename
  if (storeJson.name && storeJson.name !== fileName.replace(/\.json$/, '')) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Store name "${storeJson.name}" in ${fileName} does not match filename. ` +
      'Either remove the name field (filename is used) or make them match.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    name,
    entity: storeJson.entity,
    ttl: storeJson.ttl,
    failure: storeJson.failure,
    history: storeJson.history,
    trace: storeJson.trace,
    shared: storeJson.shared,
    location,
  } as LoadedStore;
}

/**
 * Load all store definitions from the stores/ directory.
 *
 * Each .json file in stores/ defines a store. The filename (without extension)
 * becomes the store name unless overridden by a "name" field in the JSON.
 *
 * Missing stores/ directory returns [].
 */
export async function loadStores(repoPath: string): Promise<LoadedStore[]> {
  const storesDir = path.join(repoPath, 'stores');
  const files = await listJsonFiles(storesDir);

  if (files.length === 0) {
    return [];
  }

  const results = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(storesDir, filename);
      const content = await readFile(filePath, 'utf-8');
      return parseStoreJson(content, filename, filePath);
    }),
  );

  // Check for duplicate store names
  const seen = new Set<string>();
  for (const store of results) {
    if (seen.has(store.name)) {
      throw new RepoError(
        'CONFIG_VALIDATION_FAILED',
        `Duplicate store name "${store.name}"`,
      );
    }
    seen.add(store.name);
  }

  return results;
}
