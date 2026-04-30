/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {FsSandboxError} from './index.js';
import {LocalFsBackend} from './local.js';

describe('LocalFsBackend', () => {
  let repoRoot: string;
  let backend: LocalFsBackend;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'local-fs-'));
    backend = new LocalFsBackend({repoRoot});
  });

  afterEach(async () => {
    await rm(repoRoot, {recursive: true, force: true});
  });

  it('throws when constructed with a relative path', () => {
    expect(() => new LocalFsBackend({repoRoot: 'relative/path'})).toThrow(/must be absolute/);
  });

  describe('sandboxing', () => {
    it('rejects an absolute path outside the repo', async () => {
      await expect(backend.readRepoFile('/etc/passwd')).rejects.toBeInstanceOf(FsSandboxError);
    });

    it('rejects a traversal path that escapes the repo', async () => {
      await expect(backend.readRepoFile('../../etc/passwd')).rejects.toBeInstanceOf(FsSandboxError);
    });

    it('rejects a sibling-prefix path (repo-evil)', async () => {
      // Create a directory next to repoRoot whose name shares the repoRoot's prefix.
      const sibling = `${repoRoot}-evil`;
      await mkdir(sibling, {recursive: true});
      await writeFile(path.join(sibling, 'secret.txt'), 'leak', 'utf-8');
      try {
        await expect(
          backend.readRepoFile(`../${path.basename(sibling)}/secret.txt`),
        ).rejects.toBeInstanceOf(FsSandboxError);
      } finally {
        await rm(sibling, {recursive: true, force: true});
      }
    });

    it('allows the repo root itself', async () => {
      const listing = await backend.listRepoFiles('.');
      expect(listing).toEqual({directories: [], files: []});
    });
  });

  describe('readRepoFile / writeRepoFile', () => {
    it('writes and reads a file', async () => {
      await backend.writeRepoFile('hello.txt', 'world');
      const content = await backend.readRepoFile('hello.txt');
      expect(content).toBe('world');
    });

    it('creates parent directories on write', async () => {
      await backend.writeRepoFile('nested/deep/file.txt', 'ok');
      const content = await backend.readRepoFile('nested/deep/file.txt');
      expect(content).toBe('ok');
    });

    it('overwrites an existing file atomically', async () => {
      await backend.writeRepoFile('a.txt', 'first');
      await backend.writeRepoFile('a.txt', 'second');
      const content = await backend.readRepoFile('a.txt');
      expect(content).toBe('second');
    });

    it('does not leave temp files behind on success', async () => {
      await backend.writeRepoFile('a.txt', 'final');
      const listing = await backend.listRepoFiles('.');
      expect(listing.files).toEqual(['a.txt']);
    });

    it('throws on missing file read', async () => {
      await expect(backend.readRepoFile('does-not-exist.txt')).rejects.toThrow();
    });
  });

  describe('readManyRepoFiles', () => {
    it('returns only files that exist', async () => {
      await backend.writeRepoFile('a.txt', 'A');
      await backend.writeRepoFile('b.txt', 'B');
      const result = await backend.readManyRepoFiles(['a.txt', 'missing.txt', 'b.txt']);
      expect(result).toEqual([
        {path: 'a.txt', content: 'A'},
        {path: 'b.txt', content: 'B'},
      ]);
    });
  });

  describe('listRepoFiles', () => {
    it('returns empty arrays for a missing directory', async () => {
      const listing = await backend.listRepoFiles('missing-dir');
      expect(listing).toEqual({directories: [], files: []});
    });

    it('separates directories and files', async () => {
      await backend.writeRepoFile('top.txt', 'x');
      await backend.writeRepoFile('sub/inner.txt', 'y');
      const listing = await backend.listRepoFiles('.');
      expect(listing.directories.sort()).toEqual(['sub']);
      expect(listing.files.sort()).toEqual(['top.txt']);
    });
  });

  describe('deleteRepoFile', () => {
    it('removes a file', async () => {
      await backend.writeRepoFile('victim.txt', 'bye');
      await backend.deleteRepoFile('victim.txt');
      await expect(backend.readRepoFile('victim.txt')).rejects.toThrow();
    });

    it('refuses to delete a directory', async () => {
      await mkdir(path.join(repoRoot, 'a-dir'));
      await expect(backend.deleteRepoFile('a-dir')).rejects.toThrow(/expects a file/);
    });

    it('rejects sandbox escape', async () => {
      // Create a file outside, then try to delete via traversal.
      const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
      const outsideFile = path.join(outside, 'target.txt');
      await writeFile(outsideFile, 'kill-me', 'utf-8');
      try {
        await expect(
          backend.deleteRepoFile(path.relative(repoRoot, outsideFile)),
        ).rejects.toBeInstanceOf(FsSandboxError);
        // File still there.
        const content = await readFile(outsideFile, 'utf-8');
        expect(content).toBe('kill-me');
      } finally {
        await rm(outside, {recursive: true, force: true});
      }
    });
  });
});
