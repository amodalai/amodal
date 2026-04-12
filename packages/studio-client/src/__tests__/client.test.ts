/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createStudioClient,
  StudioFetchError,
  StudioResponseParseError,
} from '../index.js';
import type { DraftFile, WorkspaceChange } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3848';
const AUTH_TOKEN = 'test-jwt-token';

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status: number, statusText: string): Response {
  return new Response(body, { status, statusText });
}

function emptyResponse(status = 200, statusText = 'OK'): Response {
  return new Response(null, { status, statusText });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createStudioClient', () => {
  describe('listDrafts', () => {
    it('fetches drafts from the correct URL with auth header', async () => {
      const drafts: DraftFile[] = [
        { filePath: 'skills/hello.md', content: '# Hello', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ drafts }));
      const client = createStudioClient({ baseUrl: BASE_URL, authToken: AUTH_TOKEN, fetchImpl: mockFetch });

      const result = await client.listDrafts();

      expect(result).toEqual(drafts);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/drafts`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: `Bearer ${AUTH_TOKEN}` }),
        }),
      );
    });

    it('omits Authorization header when no authToken provided', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ drafts: [] }));
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await client.listDrafts();

      const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(callHeaders).not.toHaveProperty('Authorization');
    });

    it('throws StudioFetchError on non-OK response', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
        Promise.resolve(textResponse('Internal Server Error', 500, 'Internal Server Error')),
      );
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await expect(client.listDrafts()).rejects.toThrow(StudioFetchError);

      const err = await client.listDrafts().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StudioFetchError);
      expect(err).toMatchObject({
        status: 500,
        statusText: 'Internal Server Error',
      });
    });
  });

  describe('getDraft', () => {
    it('encodes the file path in the URL', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ draft: { filePath: 'skills/hello world.md', content: '# Hello', updatedAt: '2026-01-01T00:00:00Z' } }),
      );
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await client.getDraft('skills/hello world.md');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/drafts/${encodeURIComponent('skills/hello world.md')}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns content on success', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ draft: { filePath: 'skills/hello.md', content: '# Hello', updatedAt: '2026-01-01T00:00:00Z' } }),
      );
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      const result = await client.getDraft('skills/hello.md');
      expect(result).toBe('# Hello');
    });

    it('returns null on 404', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        textResponse('Not Found', 404, 'Not Found'),
      );
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      const result = await client.getDraft('nonexistent.md');
      expect(result).toBeNull();
    });

    it('throws StudioFetchError on non-404 error', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        textResponse('Forbidden', 403, 'Forbidden'),
      );
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await expect(client.getDraft('secret.md')).rejects.toThrow(StudioFetchError);
    });
  });

  describe('saveDraft', () => {
    it('sends PUT with JSON body', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse());
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await client.saveDraft('skills/hello.md', '# Updated');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/drafts/${encodeURIComponent('skills/hello.md')}`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ content: '# Updated' }),
        }),
      );
    });
  });

  describe('deleteDraft', () => {
    it('sends DELETE to the correct URL', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse());
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await client.deleteDraft('skills/hello.md');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/drafts/${encodeURIComponent('skills/hello.md')}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('discardAll', () => {
    it('sends POST to discard endpoint', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse());
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await client.discardAll();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/discard`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('publish', () => {
    it('sends commit message and returns publish result', async () => {
      const publishResult = { commitSha: 'abc123', commitUrl: 'https://github.com/...' };
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(publishResult));
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      const result = await client.publish('feat: add new skill');

      expect(result).toEqual(publishResult);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/publish`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ commitMessage: 'feat: add new skill' }),
        }),
      );
    });
  });

  describe('buildPreview', () => {
    it('sends POST and returns preview result', async () => {
      const previewResult = {
        snapshotId: 'snap-1',
        previewToken: 'tok-abc',
        expiresAt: '2026-01-02T00:00:00Z',
      };
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(previewResult));
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      const result = await client.buildPreview();

      expect(result).toEqual(previewResult);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/preview`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('fetchWorkspaceBundle', () => {
    it('fetches without agentId query param when omitted', async () => {
      const bundle = { agentId: 'default', files: [] };
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(bundle));
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      const result = await client.fetchWorkspaceBundle();

      expect(result).toEqual(bundle);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/workspace`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('appends agentId query param when provided', async () => {
      const bundle = { agentId: 'my-agent', files: [{ path: 'a.md', content: 'hi' }] };
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(bundle));
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await client.fetchWorkspaceBundle('my-agent');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/workspace?agentId=${encodeURIComponent('my-agent')}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('submitDiff', () => {
    it('sends changes to batch endpoint', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse());
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      const changes: WorkspaceChange[] = [
        { path: 'skills/new.md', action: 'added', content: '# New' },
        { path: 'skills/old.md', action: 'deleted' },
        { path: 'skills/edit.md', action: 'modified', content: '# Edited' },
      ];

      await client.submitDiff(changes);

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/studio/drafts/batch`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            changes: [
              { path: 'skills/new.md', action: 'upsert', content: '# New' },
              { path: 'skills/old.md', action: 'delete' },
              { path: 'skills/edit.md', action: 'upsert', content: '# Edited' },
            ],
          }),
        }),
      );
    });
  });

  describe('JSON parse errors', () => {
    it('throws StudioResponseParseError when response is not valid JSON', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('not json at all', {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'text/plain' },
        }),
      );
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch });

      await expect(client.listDrafts()).rejects.toThrow(StudioResponseParseError);
    });
  });

  describe('timeout', () => {
    it('passes AbortSignal.timeout to every request', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ drafts: [] }));
      const client = createStudioClient({ baseUrl: BASE_URL, fetchImpl: mockFetch, timeoutMs: 5000 });

      await client.listDrafts();

      const callOptions = mockFetch.mock.calls[0]?.[1];
      expect(callOptions?.signal).toBeDefined();
    });
  });
});
