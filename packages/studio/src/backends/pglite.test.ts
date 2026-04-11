/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Runs the shared `StudioBackend` contract suite against `PGLiteStudioBackend`
 * plus a few backend-specific tests (filesystem publish behavior, init
 * idempotency, bad path guards).
 */

import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {runStudioBackendContract} from '../backend-contract.js';
import {
  PGLiteStudioBackend,
  createPGLiteStudioBackend,
} from './pglite.js';
import {StudioFeatureUnavailableError, StudioPublishError} from '../errors.js';

// Track every backend + temp repo we create so `cleanup` can tear them down.
const activeTempDirs = new Set<string>();

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'studio-pglite-'));
  activeTempDirs.add(dir);
  return dir;
}

async function tearDownTempRepo(dir: string): Promise<void> {
  activeTempDirs.delete(dir);
  await rm(dir, {recursive: true, force: true});
}

runStudioBackendContract('PGLiteStudioBackend (in-memory)', {
  async createBackend() {
    const repoPath = await makeTempRepo();
    const backend = await createPGLiteStudioBackend({repoPath});
    // Tag the backend instance with its temp repo so cleanup can find it.
    (backend as PGLiteStudioBackend & {__repoPath: string}).__repoPath =
      repoPath;
    return backend;
  },
  async cleanup(backend) {
    const tagged = backend as PGLiteStudioBackend & {__repoPath?: string};
    if (backend instanceof PGLiteStudioBackend) {
      await backend.close();
    }
    if (tagged.__repoPath) {
      await tearDownTempRepo(tagged.__repoPath);
    }
  },
});

describe('PGLiteStudioBackend — implementation specifics', () => {
  let repoPath: string;
  let backend: PGLiteStudioBackend;

  beforeEach(async () => {
    repoPath = await makeTempRepo();
    backend = await createPGLiteStudioBackend({repoPath});
  });

  afterEach(async () => {
    await backend.close();
    await tearDownTempRepo(repoPath);
  });

  it('init is idempotent', async () => {
    // Double init on an already-initialized backend must not throw or re-run
    // DDL destructively.
    await backend.init();
    await backend.init();
    await backend.setDraft('user', 'a.md', 'content');
    expect(await backend.getDraft('user', 'a.md')).toBe('content');
  });

  it('publish writes draft contents to the local repo filesystem', async () => {
    await backend.setDraft('user', 'skills/one.md', 'hello one');
    await backend.setDraft('user', 'knowledge/two.md', 'hello two');

    const result = await backend.publish('user', 'test publish');

    expect(result.commitSha).toMatch(/^local-[0-9a-f]{16}$/);
    expect(result.commitUrl).toBeUndefined();

    const oneOnDisk = await readFile(join(repoPath, 'skills/one.md'), 'utf8');
    const twoOnDisk = await readFile(
      join(repoPath, 'knowledge/two.md'),
      'utf8',
    );
    expect(oneOnDisk).toBe('hello one');
    expect(twoOnDisk).toBe('hello two');

    // Drafts cleared.
    expect(await backend.listDrafts('user')).toEqual([]);
  });

  it('publish creates intermediate directories as needed', async () => {
    await backend.setDraft('user', 'deep/nested/path/file.md', 'deep');
    await backend.publish('user', 'nested publish');
    const onDisk = await readFile(
      join(repoPath, 'deep/nested/path/file.md'),
      'utf8',
    );
    expect(onDisk).toBe('deep');
  });

  it('publish rejects absolute paths', async () => {
    await backend.setDraft('user', '/etc/passwd', 'nope');
    await expect(backend.publish('user', 'attack')).rejects.toBeInstanceOf(
      StudioPublishError,
    );
    // Drafts remain staged after a failed publish.
    const after = await backend.listDrafts('user');
    expect(after).toHaveLength(1);
  });

  it('publish rejects paths that escape the repo root', async () => {
    await backend.setDraft('user', '../outside.md', 'nope');
    await expect(backend.publish('user', 'attack')).rejects.toBeInstanceOf(
      StudioPublishError,
    );
    const after = await backend.listDrafts('user');
    expect(after).toHaveLength(1);
  });

  it('buildPreview throws StudioFeatureUnavailableError', async () => {
    await expect(backend.buildPreview('user')).rejects.toBeInstanceOf(
      StudioFeatureUnavailableError,
    );
  });

  it('rejects construction with both pglite and dataDir', async () => {
    const {PGlite} = await import('@electric-sql/pglite');
    const injected = new PGlite();
    try {
      expect(
        () =>
          new PGLiteStudioBackend({
            repoPath,
            pglite: injected,
            dataDir: '/tmp/whatever',
          }),
      ).toThrow();
    } finally {
      await injected.close();
    }
  });

  it('accepts an externally-injected PGlite instance', async () => {
    const {PGlite} = await import('@electric-sql/pglite');
    const injected = new PGlite();
    try {
      const injectedBackend = new PGLiteStudioBackend({
        repoPath,
        pglite: injected,
      });
      await injectedBackend.init();
      await injectedBackend.setDraft('u', 'p.md', 'x');
      expect(await injectedBackend.getDraft('u', 'p.md')).toBe('x');
      // close() is a no-op when the backend doesn't own the instance.
      await injectedBackend.close();
      // Still usable via the injected handle.
      const result = await injected.query<{content: string}>(
        'SELECT content FROM studio_drafts WHERE user_id = $1',
        ['u'],
      );
      expect(result.rows).toHaveLength(1);
    } finally {
      await injected.close();
    }
  });
});
