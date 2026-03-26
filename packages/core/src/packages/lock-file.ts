/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, rename, writeFile, mkdir} from 'node:fs/promises';
import * as path from 'node:path';

import {PackageError} from './package-error.js';
import {
  LockFileSchema,
  packageKey,
  parsePackageKey,
} from './package-types.js';
import type {LockEntry, LockFile, PackageType} from './package-types.js';

const LOCK_FILENAME = 'amodal.lock';

/**
 * Get the full path to the lock file for a repo.
 */
function lockFilePath(repoPath: string): string {
  return path.join(repoPath, LOCK_FILENAME);
}

/**
 * Read the lock file. Returns null if it doesn't exist (first install).
 */
export async function readLockFile(repoPath: string): Promise<LockFile | null> {
  const filePath = lockFilePath(repoPath);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new PackageError('LOCK_READ_FAILED', `Failed to read lock file: ${filePath}`, err);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new PackageError('LOCK_READ_FAILED', `Invalid JSON in lock file: ${filePath}`, err);
  }

  const result = LockFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new PackageError('LOCK_READ_FAILED', `Lock file validation failed: ${issues}`);
  }

  return result.data;
}

/**
 * Write the lock file atomically.
 */
export async function writeLockFile(repoPath: string, lock: LockFile): Promise<void> {
  const filePath = lockFilePath(repoPath);
  const dirPath = path.dirname(filePath);

  try {
    await mkdir(dirPath, {recursive: true});
  } catch {
    // Directory may already exist
  }

  const content = JSON.stringify(lock, null, 2) + '\n';
  const tmpPath = `${filePath}.tmp`;

  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (err) {
    throw new PackageError('LOCK_WRITE_FAILED', `Failed to write lock file: ${filePath}`, err);
  }
}

/**
 * Add or update a lock entry. Creates the lock file if needed.
 */
export async function addLockEntry(
  repoPath: string,
  type: PackageType,
  name: string,
  entry: LockEntry,
): Promise<LockFile> {
  const lock = (await readLockFile(repoPath)) ?? {lockVersion: 1, packages: {}};
  const key = packageKey(type, name);
  lock.packages[key] = entry;
  await writeLockFile(repoPath, lock);
  return lock;
}

/**
 * Remove a lock entry. Returns the updated lock file.
 */
export async function removeLockEntry(
  repoPath: string,
  type: PackageType,
  name: string,
): Promise<LockFile> {
  const lock = (await readLockFile(repoPath)) ?? {lockVersion: 1, packages: {}};
  const key = packageKey(type, name);
  delete lock.packages[key];
  await writeLockFile(repoPath, lock);
  return lock;
}

/**
 * Get a single lock entry. Returns null if not found.
 */
export async function getLockEntry(
  repoPath: string,
  type: PackageType,
  name: string,
): Promise<LockEntry | null> {
  const lock = await readLockFile(repoPath);
  if (!lock) return null;
  const key = packageKey(type, name);
  return lock.packages[key] ?? null;
}

/**
 * List lock entries, optionally filtered by type.
 */
export async function listLockEntries(
  repoPath: string,
  type?: PackageType,
): Promise<Array<{key: string; type: PackageType; name: string; entry: LockEntry}>> {
  const lock = await readLockFile(repoPath);
  if (!lock) return [];

  const results: Array<{key: string; type: PackageType; name: string; entry: LockEntry}> = [];

  for (const [key, entry] of Object.entries(lock.packages)) {
    const parsed = parsePackageKey(key);
    if (type && parsed.type !== type) continue;
    results.push({key, type: parsed.type, name: parsed.name, entry});
  }

  return results;
}
