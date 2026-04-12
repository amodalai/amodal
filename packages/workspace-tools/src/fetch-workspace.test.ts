/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceFetchError,
  WorkspaceSizeLimitError,
} from './errors.js';
import { fetchWorkspace } from './fetch-workspace.js';
import type { Logger, WorkspaceBundleResponse } from './types.js';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function mockFetchResponse(body: WorkspaceBundleResponse, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  }));
}

describe('fetchWorkspace', () => {
  let logger: Logger;
  let cleanupPaths: string[];

  beforeEach(() => {
    logger = createMockLogger();
    cleanupPaths = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true });
    }
  });

  it('fetches files and writes to sandbox', async () => {
    const bundle: WorkspaceBundleResponse = {
      files: [
        { path: 'amodal.json', content: '{"name": "test"}' },
        { path: 'skills/greet.md', content: '# Greet' },
      ],
    };
    mockFetchResponse(bundle);

    const { result, sandbox } = await fetchWorkspace(
      {},
      { studioBaseUrl: 'http://localhost:3000', sessionId: 'sess-1', logger },
    );
    cleanupPaths.push(sandbox.getRoot());

    expect(result.fileCount).toBe(2);
    expect(result.sandboxPath).toBe(sandbox.getRoot());

    const content = await fs.readFile(
      path.join(sandbox.getRoot(), 'amodal.json'),
      'utf-8',
    );
    expect(content).toBe('{"name": "test"}');

    const skillContent = await fs.readFile(
      path.join(sandbox.getRoot(), 'skills/greet.md'),
      'utf-8',
    );
    expect(skillContent).toBe('# Greet');
  });

  it('stashes manifest for later diffing', async () => {
    const bundle: WorkspaceBundleResponse = {
      files: [{ path: 'a.txt', content: 'hello' }],
    };
    mockFetchResponse(bundle);

    const { sandbox } = await fetchWorkspace(
      {},
      { studioBaseUrl: 'http://localhost:3000', sessionId: 'sess-2', logger },
    );
    cleanupPaths.push(sandbox.getRoot());

    const manifest = sandbox.getManifest();
    expect(manifest.size).toBe(1);
    expect(manifest.has('a.txt')).toBe(true);
  });

  it('passes agentId as query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ files: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { sandbox } = await fetchWorkspace(
      { agentId: 'my-agent' },
      { studioBaseUrl: 'http://localhost:3000', sessionId: 'sess-3', logger },
    );
    cleanupPaths.push(sandbox.getRoot());

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('agentId=my-agent');
  });

  it('rejects oversized workspaces', async () => {
    // Create content that exceeds 100MB
    const largeContent = 'x'.repeat(60 * 1024 * 1024);
    const bundle: WorkspaceBundleResponse = {
      files: [
        { path: 'big1.txt', content: largeContent },
        { path: 'big2.txt', content: largeContent },
      ],
    };
    mockFetchResponse(bundle);

    await expect(
      fetchWorkspace(
        {},
        { studioBaseUrl: 'http://localhost:3000', sessionId: 'sess-4', logger },
      ),
    ).rejects.toThrow(WorkspaceSizeLimitError);
  });

  it('throws WorkspaceFetchError on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await expect(
      fetchWorkspace(
        {},
        { studioBaseUrl: 'http://localhost:3000', sessionId: 'sess-5', logger },
      ),
    ).rejects.toThrow(WorkspaceFetchError);
  });

  it('throws WorkspaceFetchError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(
      fetchWorkspace(
        {},
        { studioBaseUrl: 'http://localhost:3000', sessionId: 'sess-6', logger },
      ),
    ).rejects.toThrow(WorkspaceFetchError);
  });

  it('logs start and completion events', async () => {
    mockFetchResponse({ files: [] });

    const { sandbox } = await fetchWorkspace(
      {},
      { studioBaseUrl: 'http://localhost:3000', sessionId: 'sess-7', logger },
    );
    cleanupPaths.push(sandbox.getRoot());

    expect(logger.info).toHaveBeenCalledWith(
      'fetch_workspace_start',
      expect.objectContaining({ session_id: 'sess-7' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'fetch_workspace_complete',
      expect.objectContaining({ session_id: 'sess-7', file_count: 0 }),
    );
  });
});
