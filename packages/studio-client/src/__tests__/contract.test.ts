/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Contract tests for the studio-client.
 *
 * These verify the client correctly parses response shapes that the Studio
 * API actually returns. They use mock fetch to simulate Studio responses
 * with realistic payloads, ensuring the contract between client and server
 * remains intact.
 */

import {describe, it, expect, vi} from 'vitest';
import {
  createStudioClient,
  StudioFetchError,
} from '../index.js';
import type {
  DraftFile,
  PublishResult,
  PreviewResult,
  WorkspaceBundle,
} from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3848';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {'Content-Type': 'application/json'},
  });
}

// ---------------------------------------------------------------------------
// Contract: Studio API response shapes
// ---------------------------------------------------------------------------

describe('studio-client contract — response shapes match Studio API', () => {
  describe('workspace bundle shape matches workspace-tools expectations', () => {
    it('fetchWorkspaceBundle returns agentId + files array', async () => {
      // This is the shape that Studio actually returns and that
      // @amodalai/workspace-tools expects to receive
      const studioApiResponse: WorkspaceBundle = {
        agentId: 'my-agent',
        files: [
          {path: 'amodal.json', content: '{"name":"my-agent","version":"1.0.0"}'},
          {path: 'skills/greet.md', content: '# Greeting Skill\n\nSay hello.'},
          {path: 'knowledge/faq.md', content: '# FAQ\n\nCommon questions.'},
        ],
      };

      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(studioApiResponse),
      );

      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});
      const bundle = await client.fetchWorkspaceBundle('my-agent');

      // Verify the shape matches what workspace-tools fetchWorkspace expects
      expect(bundle.agentId).toBe('my-agent');
      expect(bundle.files).toBeInstanceOf(Array);
      expect(bundle.files).toHaveLength(3);

      // Each file has path + content (the same shape as WorkspaceFile in workspace-tools)
      for (const file of bundle.files) {
        expect(file).toHaveProperty('path');
        expect(file).toHaveProperty('content');
        expect(typeof file.path).toBe('string');
        expect(typeof file.content).toBe('string');
      }
    });

    it('handles empty workspace (no files)', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({agentId: 'empty-agent', files: []}),
      );

      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});
      const bundle = await client.fetchWorkspaceBundle('empty-agent');

      expect(bundle.agentId).toBe('empty-agent');
      expect(bundle.files).toEqual([]);
    });
  });

  describe('draft operations match config editing workflow', () => {
    it('listDrafts returns full DraftFile objects with timestamps', async () => {
      const drafts: DraftFile[] = [
        {filePath: 'skills/greet.md', content: '# Greet', updatedAt: '2026-04-11T00:00:00Z'},
        {filePath: 'knowledge/faq.md', content: '# FAQ', updatedAt: '2026-04-11T01:00:00Z'},
        {filePath: 'amodal.json', content: '{"name":"test"}', updatedAt: '2026-04-10T12:00:00Z'},
      ];

      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ drafts }));
      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});

      const result = await client.listDrafts();
      expect(result).toHaveLength(3);

      // Each draft has the full shape needed for the config editing UI
      for (const draft of result) {
        expect(draft).toHaveProperty('filePath');
        expect(draft).toHaveProperty('content');
        expect(draft).toHaveProperty('updatedAt');
        expect(typeof draft.filePath).toBe('string');
        expect(typeof draft.content).toBe('string');
        expect(typeof draft.updatedAt).toBe('string');
      }
    });

    it('getDraft returns file content string', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ draft: { filePath: 'skills/greet.md', content: '# Updated Greeting\n\nSay hi warmly.', updatedAt: '2026-04-11T00:00:00Z' } }),
      );

      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});
      const content = await client.getDraft('skills/greet.md');

      expect(content).toBe('# Updated Greeting\n\nSay hi warmly.');
    });
  });

  describe('publish returns commit metadata', () => {
    it('returns commitSha and optional commitUrl', async () => {
      const publishResult: PublishResult = {
        commitSha: 'a1b2c3d4e5f6789012345678901234567890abcd',
        commitUrl: 'https://github.com/org/repo/commit/a1b2c3d4',
      };

      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(publishResult),
      );

      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});
      const result = await client.publish('feat: add greeting skill');

      expect(result.commitSha).toBe('a1b2c3d4e5f6789012345678901234567890abcd');
      expect(result.commitUrl).toBe('https://github.com/org/repo/commit/a1b2c3d4');
    });

    it('handles publish result without commitUrl', async () => {
      const publishResult: PublishResult = {
        commitSha: 'deadbeef',
      };

      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(publishResult),
      );

      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});
      const result = await client.publish('chore: update config');

      expect(result.commitSha).toBe('deadbeef');
      expect(result.commitUrl).toBeUndefined();
    });
  });

  describe('preview returns snapshot metadata', () => {
    it('returns snapshotId, previewToken, and expiresAt', async () => {
      const previewResult: PreviewResult = {
        snapshotId: 'snap-abc123',
        previewToken: 'tok-preview-xyz',
        expiresAt: '2026-04-12T00:00:00Z',
      };

      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(previewResult),
      );

      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});
      const result = await client.buildPreview();

      expect(result.snapshotId).toBe('snap-abc123');
      expect(result.previewToken).toBe('tok-preview-xyz');
      expect(result.expiresAt).toBe('2026-04-12T00:00:00Z');
    });
  });

  describe('submitDiff sends correct change format', () => {
    it('maps workspace change actions to batch actions for the Studio API', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {status: 200, statusText: 'OK'}),
      );

      const client = createStudioClient({baseUrl: BASE_URL, fetchImpl: mockFetch});

      await client.submitDiff([
        {path: 'skills/new.md', action: 'added', content: '# New Skill'},
        {path: 'skills/edit.md', action: 'modified', content: '# Edited'},
        {path: 'skills/old.md', action: 'deleted'},
      ]);

      expect(mockFetch).toHaveBeenCalledOnce();

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as {changes: Array<{path: string; action: string; content?: string}>};

      expect(body.changes).toHaveLength(3);

      // 'added' and 'modified' map to 'upsert', 'deleted' maps to 'delete'
      const upserts = body.changes.filter((c) => c.action === 'upsert');
      expect(upserts).toHaveLength(2);
      expect(upserts.find((c) => c.path === 'skills/new.md')).toMatchObject({content: '# New Skill'});
      expect(upserts.find((c) => c.path === 'skills/edit.md')).toMatchObject({content: '# Edited'});

      const deletes = body.changes.filter((c) => c.action === 'delete');
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).toMatchObject({path: 'skills/old.md'});
    });
  });

  describe('error handling at the contract boundary', () => {
    it('non-OK responses throw StudioFetchError with status context', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"error":"forbidden"}', {status: 403, statusText: 'Forbidden'}),
      );

      const client = createStudioClient({
        baseUrl: BASE_URL,
        authToken: 'expired-token',
        fetchImpl: mockFetch,
      });

      const error = await client.listDrafts().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StudioFetchError);
       
      const fetchError = error as InstanceType<typeof StudioFetchError>;
      expect(fetchError.status).toBe(403);
      expect(fetchError.statusText).toBe('Forbidden');
      expect(fetchError.url).toContain('/api/studio/drafts');
    });
  });
});
