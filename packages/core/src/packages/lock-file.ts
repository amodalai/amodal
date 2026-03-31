/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, rename, writeFile, mkdir} from 'node:fs/promises';
import * as path from 'node:path';

import {PackageError} from './package-error.js';
import {LockFileSchema} from './package-types.js';
import type {LockEntry, LockFile} from './package-types.js';

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
 * Add or update a lock entry by npm package name.
 */
export async function addLockEntry(
  repoPath: string,
  npmName: string,
  entry: LockEntry,
): Promise<LockFile> {
  const lock = (await readLockFile(repoPath)) ?? {lockVersion: 2 as const, packages: {}};
  lock.packages[npmName] = entry;
  await writeLockFile(repoPath, lock);
  return lock;
}

/**
 * Remove a lock entry by npm package name.
 */
export async function removeLockEntry(
  repoPath: string,
  npmName: string,
): Promise<LockFile> {
  const lock = (await readLockFile(repoPath)) ?? {lockVersion: 2 as const, packages: {}};
  delete lock.packages[npmName];
  await writeLockFile(repoPath, lock);
  return lock;
}

/**
 * Build a lock file from a list of discovered packages.
 */
export async function buildLockFile(
  repoPath: string,
  packages: Array<{npmName: string; version: string; integrity: string}>,
): Promise<LockFile> {
  const lock: LockFile = {lockVersion: 2, packages: {}};
  for (const pkg of packages) {
    lock.packages[pkg.npmName] = {version: pkg.version, integrity: pkg.integrity};
  }
  await writeLockFile(repoPath, lock);
  return lock;
}

/**
 * Get a single lock entry by npm name. Returns null if not found.
 */
export async function getLockEntry(
  repoPath: string,
  npmName: string,
): Promise<LockEntry | null> {
  const lock = await readLockFile(repoPath);
  if (!lock) return null;
  return lock.packages[npmName] ?? null;
}

/**
 * List all lock entries.
 */
export async function listLockEntries(
  repoPath: string,
): Promise<Array<{npmName: string; entry: LockEntry}>> {
  const lock = await readLockFile(repoPath);
  if (!lock) return [];

  return Object.entries(lock.packages).map(([npmName, entry]) => ({npmName, entry}));
}
