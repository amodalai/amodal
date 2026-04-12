/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSubmitError } from './errors.js';
import { Sandbox } from './sandbox.js';
import { submitDiff } from './submit-diff.js';
import type { Logger } from './types.js';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('submitDiff', () => {
  let sandbox: Sandbox;
  let logger: Logger;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    logger = createMockLogger();
    sandbox = await Sandbox.create('diff-test');

    // Write initial files to sandbox
    const root = sandbox.getRoot();
    await fs.writeFile(path.join(root, 'existing.txt'), 'original content');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub/nested.txt'), 'nested content');

    // Stash manifest
    sandbox.stashManifest([
      { path: 'existing.txt', content: 'original content' },
      { path: 'sub/nested.txt', content: 'nested content' },
      { path: 'to-delete.txt', content: 'will be deleted' },
    ]);

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await sandbox.cleanup();
  });

  it('detects added files', async () => {
    await fs.writeFile(
      path.join(sandbox.getRoot(), 'new-file.txt'),
      'new content',
    );

    const result = await submitDiff(
      {},
      {
        studioBaseUrl: 'http://localhost:3000',
        sessionId: 'sess-1',
        sandbox,
        logger,
      },
    );

    expect(result.added).toBe(1);
    expect(result.deleted).toBe(1); // to-delete.txt
    expect(result.modified).toBe(0);
  });

  it('detects modified files', async () => {
    await fs.writeFile(
      path.join(sandbox.getRoot(), 'existing.txt'),
      'modified content',
    );

    const result = await submitDiff(
      {},
      {
        studioBaseUrl: 'http://localhost:3000',
        sessionId: 'sess-2',
        sandbox,
        logger,
      },
    );

    expect(result.modified).toBe(1);
  });

  it('detects deleted files', async () => {
    // to-delete.txt is in manifest but not on disk
    const result = await submitDiff(
      {},
      {
        studioBaseUrl: 'http://localhost:3000',
        sessionId: 'sess-3',
        sandbox,
        logger,
      },
    );

    expect(result.deleted).toBe(1);
  });

  it('sends changes to studio API', async () => {
    await fs.writeFile(
      path.join(sandbox.getRoot(), 'new.txt'),
      'added',
    );

    await submitDiff(
      { commitMessage: 'test commit' },
      {
        studioBaseUrl: 'http://localhost:3000',
        sessionId: 'sess-4',
        sandbox,
        logger,
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/studio/drafts/batch');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string) as {
      changes: Array<{ path: string; action: string; content?: string }>;
    };
    expect(body.changes).toBeInstanceOf(Array);
    // Verify workspace change kinds are mapped to batch actions
    for (const change of body.changes) {
      expect(['upsert', 'delete']).toContain(change.action);
    }
  });

  it('throws WorkspaceSubmitError on API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await expect(
      submitDiff(
        {},
        {
          studioBaseUrl: 'http://localhost:3000',
          sessionId: 'sess-5',
          sandbox,
          logger,
        },
      ),
    ).rejects.toThrow(WorkspaceSubmitError);
  });

  it('reports zero changes when nothing modified', async () => {
    // Remove to-delete.txt from manifest by recreating sandbox
    await sandbox.cleanup();
    sandbox = await Sandbox.create('diff-test-clean');
    const root = sandbox.getRoot();
    await fs.writeFile(path.join(root, 'a.txt'), 'content');
    sandbox.stashManifest([{ path: 'a.txt', content: 'content' }]);

    const result = await submitDiff(
      {},
      {
        studioBaseUrl: 'http://localhost:3000',
        sessionId: 'sess-6',
        sandbox,
        logger,
      },
    );

    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.deleted).toBe(0);
  });
});
