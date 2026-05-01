/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `LocalFsBackend` — direct fs/promises implementation of `FsBackend`,
 * used by `amodal dev` and any other runtime that operates against a
 * physical repo on disk.
 *
 * Sandboxing: every input path is normalized and rejected if the
 * resolved absolute path does not sit under `repoRoot`. Both `..`
 * traversal and absolute paths are caught by the same prefix check —
 * `path.resolve(repoRoot, repoPath)` collapses traversal, then the
 * result is asserted against `repoRoot` before any fs call runs.
 *
 * Writes are atomic: write-to-temp followed by `rename`. The temp file
 * lives next to the destination so the rename never crosses devices.
 */

import {randomBytes} from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';

import {FsSandboxError, type FsBackend, type RepoDirListing, type RepoFileEntry} from './index.js';

export interface LocalFsBackendOptions {
  /** Absolute path to the repo root. Every read/write resolves against this. */
  repoRoot: string;
}

export class LocalFsBackend implements FsBackend {
  readonly #repoRoot: string;

  constructor(opts: LocalFsBackendOptions) {
    if (!path.isAbsolute(opts.repoRoot)) {
      throw new Error(`LocalFsBackend repoRoot must be absolute, got: ${opts.repoRoot}`);
    }
    // Resolve to canonical form so `..` segments inside repoRoot itself don't fool the prefix check.
    this.#repoRoot = path.resolve(opts.repoRoot);
  }

  /**
   * Resolve a repo-relative path to an absolute path inside the sandbox.
   * Throws `FsSandboxError` when the resolved path escapes `repoRoot`.
   */
  #resolveSandboxed(repoPath: string): string {
    const normalized = path.resolve(this.#repoRoot, repoPath);
    // Prefix check with separator guard — `/repo` must not match `/repo-evil`.
    const rootWithSep = this.#repoRoot.endsWith(path.sep)
      ? this.#repoRoot
      : `${this.#repoRoot}${path.sep}`;
    if (normalized !== this.#repoRoot && !normalized.startsWith(rootWithSep)) {
      throw new FsSandboxError(
        `Path "${repoPath}" resolves outside the repo sandbox (${this.#repoRoot})`,
      );
    }
    return normalized;
  }

  async readRepoFile(repoPath: string): Promise<string> {
    const abs = this.#resolveSandboxed(repoPath);
    return readFile(abs, 'utf-8');
  }

  async writeRepoFile(repoPath: string, content: string): Promise<void> {
    const abs = this.#resolveSandboxed(repoPath);
    const dir = path.dirname(abs);
    await mkdir(dir, {recursive: true});

    // Atomic write: write to a temp sibling, then rename.
    const tempPath = `${abs}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(tempPath, content, 'utf-8');
      await rename(tempPath, abs);
    } catch (err) {
      // Best-effort cleanup of the temp file; don't mask the original error.
      await rm(tempPath, {force: true}).catch(() => undefined);
      throw err;
    }
  }

  async readManyRepoFiles(repoPaths: string[]): Promise<RepoFileEntry[]> {
    const results = await Promise.all(
      repoPaths.map(async (p): Promise<RepoFileEntry | null> => {
        const abs = this.#resolveSandboxed(p);
        try {
          const content = await readFile(abs, 'utf-8');
          return {path: p, content};
        } catch (err) {
          if (isNotFoundError(err)) return null;
          throw err;
        }
      }),
    );
    return results.filter((entry): entry is RepoFileEntry => entry !== null);
  }

  async listRepoFiles(repoPath: string): Promise<RepoDirListing> {
    const abs = this.#resolveSandboxed(repoPath);
    const directories: string[] = [];
    const files: string[] = [];
    try {
      const entries = await readdir(abs, {withFileTypes: true, encoding: 'utf8'});
      for (const entry of entries) {
        // String coercion keeps newer @types/node happy — the default
        // overload widens entry.name to NonSharedBuffer otherwise.
        const name = String(entry.name);
        if (entry.isDirectory()) directories.push(name);
        else if (entry.isFile()) files.push(name);
        // Symlinks and special files are ignored — handlers shouldn't be
        // chasing them during repo edits.
      }
    } catch (err) {
      if (isNotFoundError(err)) return {directories: [], files: []};
      throw err;
    }
    return {directories, files};
  }

  async deleteRepoFile(repoPath: string): Promise<void> {
    const abs = this.#resolveSandboxed(repoPath);
    // Pre-check that the target is a regular file — never delete a directory.
    const s = await stat(abs);
    if (!s.isFile()) {
      throw new Error(`deleteRepoFile expects a file, got a directory at "${repoPath}"`);
    }
    await unlink(abs);
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as {code: unknown}).code === 'ENOENT'
  );
}
