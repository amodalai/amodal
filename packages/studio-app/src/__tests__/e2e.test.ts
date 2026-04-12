/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end tests for Studio API route handlers.
 *
 * Tests the route handlers directly by importing them and calling with
 * constructed NextRequest objects. Uses PGLite in-memory backend for
 * isolation (each test suite gets a fresh temp directory).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Env setup — must happen before any route/lib imports that read process.env
// ---------------------------------------------------------------------------

let tmpDir: string;
let repoPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-e2e-'));
  repoPath = path.join(tmpDir, 'repo');
  await fs.mkdir(repoPath, { recursive: true });

  // Seed the repo with a minimal agent config + test skill
  await fs.writeFile(
    path.join(repoPath, 'amodal.json'),
    JSON.stringify({ name: 'test-agent', description: 'E2E test agent' }),
  );
  await fs.mkdir(path.join(repoPath, 'skills'), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, 'skills', 'test-skill.md'),
    '# Test Skill\n\nThis is a test skill for e2e tests.',
  );

  // Set env vars before importing route handlers
  process.env['REPO_PATH'] = repoPath;
  process.env['PGLITE_DATA_DIR'] = path.join(tmpDir, 'pglite-data');
  process.env['STUDIO_CORS_ORIGINS'] = 'http://localhost:3847,http://test-origin.example.com';
  process.env['LOG_LEVEL'] = 'none';
});

afterAll(async () => {
  // Reset the backend singleton so subsequent test runs start fresh
  const { resetBackend } = await import('@/lib/startup');
  resetBackend();

  // Clean up temp directory
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Lazy-import route handlers (after env vars are set)
// ---------------------------------------------------------------------------

async function importDraftsRoute() {
  return import('@/app/api/studio/drafts/route');
}

async function importDraftFileRoute() {
  return import('@/app/api/studio/drafts/[...filePath]/route');
}

async function importBatchRoute() {
  return import('@/app/api/studio/drafts/batch/route');
}

async function importPublishRoute() {
  return import('@/app/api/studio/publish/route');
}

async function importDiscardRoute() {
  return import('@/app/api/studio/discard/route');
}

async function importWorkspaceRoute() {
  return import('@/app/api/studio/workspace/route');
}

async function importPreviewRoute() {
  return import('@/app/api/studio/preview/route');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3850';

function makeRequest(urlPath: string, init?: RequestInit): NextRequest {
  return new NextRequest(`${BASE_URL}${urlPath}`, init);
}

function makeRouteParams(filePath: string): { params: Promise<{ filePath: string[] }> } {
  return {
    params: Promise.resolve({ filePath: filePath.split('/') }),
  };
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json();
}

// ---------------------------------------------------------------------------
// 1. Studio serves empty drafts on fresh start
// ---------------------------------------------------------------------------

describe('Studio API E2E', () => {
  it('serves empty drafts on fresh start', async () => {
    const { GET } = await importDraftsRoute();
    const response = await GET(makeRequest('/api/studio/drafts'));

    expect(response.status).toBe(200);
    const body = await parseJson(response) as { drafts: unknown[] };
    expect(body.drafts).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Draft CRUD cycle
  // -------------------------------------------------------------------------

  it('supports full draft CRUD cycle', async () => {
    const draftsRoute = await importDraftsRoute();
    const fileRoute = await importDraftFileRoute();

    // PUT a draft
    const putResponse = await fileRoute.PUT(
      makeRequest('/api/studio/drafts/skills/hello.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Hello\n\nGreeting skill.' }),
      }),
      makeRouteParams('skills/hello.md'),
    );
    expect(putResponse.status).toBe(200);

    // List drafts — should have 1
    const listResponse = await draftsRoute.GET(makeRequest('/api/studio/drafts'));
    const listBody = await parseJson(listResponse) as { drafts: Array<{ filePath: string; content: string }> };
    expect(listBody.drafts).toHaveLength(1);
    expect(listBody.drafts[0].filePath).toBe('skills/hello.md');
    expect(listBody.drafts[0].content).toBe('# Hello\n\nGreeting skill.');

    // GET the specific draft
    const getResponse = await fileRoute.GET(
      makeRequest('/api/studio/drafts/skills/hello.md'),
      makeRouteParams('skills/hello.md'),
    );
    expect(getResponse.status).toBe(200);
    const getBody = await parseJson(getResponse) as { draft: { filePath: string; content: string } };
    expect(getBody.draft.filePath).toBe('skills/hello.md');
    expect(getBody.draft.content).toBe('# Hello\n\nGreeting skill.');

    // DELETE the draft
    const deleteResponse = await fileRoute.DELETE(
      makeRequest('/api/studio/drafts/skills/hello.md', { method: 'DELETE' }),
      makeRouteParams('skills/hello.md'),
    );
    expect(deleteResponse.status).toBe(200);

    // List drafts — should be empty
    const finalListResponse = await draftsRoute.GET(makeRequest('/api/studio/drafts'));
    const finalListBody = await parseJson(finalListResponse) as { drafts: unknown[] };
    expect(finalListBody.drafts).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 3. Publish writes drafts to disk
  // -------------------------------------------------------------------------

  it('publish writes drafts to disk and clears them', async () => {
    const fileRoute = await importDraftFileRoute();
    const draftsRoute = await importDraftsRoute();
    const publishRoute = await importPublishRoute();

    // PUT a draft
    await fileRoute.PUT(
      makeRequest('/api/studio/drafts/skills/published.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Published Skill\n\nThis should end up on disk.' }),
      }),
      makeRouteParams('skills/published.md'),
    );

    // Publish
    const publishResponse = await publishRoute.POST(
      makeRequest('/api/studio/publish', { method: 'POST' }),
    );
    expect(publishResponse.status).toBe(200);
    const publishBody = await parseJson(publishResponse) as { commitSha: string; filesPublished: number };
    expect(publishBody.filesPublished).toBe(1);
    expect(publishBody.commitSha).toMatch(/^local-/);

    // Verify file on disk
    const diskContent = await fs.readFile(
      path.join(repoPath, 'skills', 'published.md'),
      'utf-8',
    );
    expect(diskContent).toBe('# Published Skill\n\nThis should end up on disk.');

    // Drafts should be cleared
    const listResponse = await draftsRoute.GET(makeRequest('/api/studio/drafts'));
    const listBody = await parseJson(listResponse) as { drafts: unknown[] };
    expect(listBody.drafts).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 4. Discard clears all drafts without writing to disk
  // -------------------------------------------------------------------------

  it('discard clears drafts without writing to disk', async () => {
    const fileRoute = await importDraftFileRoute();
    const draftsRoute = await importDraftsRoute();
    const discardRoute = await importDiscardRoute();

    // PUT two drafts
    await fileRoute.PUT(
      makeRequest('/api/studio/drafts/skills/discard-a.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Draft A' }),
      }),
      makeRouteParams('skills/discard-a.md'),
    );
    await fileRoute.PUT(
      makeRequest('/api/studio/drafts/skills/discard-b.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Draft B' }),
      }),
      makeRouteParams('skills/discard-b.md'),
    );

    // Discard
    const discardResponse = await discardRoute.POST(
      makeRequest('/api/studio/discard', { method: 'POST' }),
    );
    expect(discardResponse.status).toBe(200);
    const discardBody = await parseJson(discardResponse) as { discarded: number };
    expect(discardBody.discarded).toBe(2);

    // Drafts should be empty
    const listResponse = await draftsRoute.GET(makeRequest('/api/studio/drafts'));
    const listBody = await parseJson(listResponse) as { drafts: unknown[] };
    expect(listBody.drafts).toEqual([]);

    // Files should NOT exist on disk
    await expect(
      fs.access(path.join(repoPath, 'skills', 'discard-a.md')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(repoPath, 'skills', 'discard-b.md')),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 5. Workspace endpoint serves the agent file tree
  // -------------------------------------------------------------------------

  it('workspace endpoint serves the agent file tree', async () => {
    const { GET } = await importWorkspaceRoute();
    const response = await GET(makeRequest('/api/studio/workspace'));

    expect(response.status).toBe(200);
    const body = await parseJson(response) as {
      agentId: string;
      files: Array<{ path: string; content: string }>;
    };

    expect(body.agentId).toBe('test-agent');

    // Should include the seeded files
    const filePaths = body.files.map(f => f.path);
    expect(filePaths).toContain('amodal.json');
    expect(filePaths).toContain('skills/test-skill.md');

    // Should include the published file from test 3
    expect(filePaths).toContain('skills/published.md');

    // Verify content of a known file
    const skillFile = body.files.find(f => f.path === 'skills/test-skill.md');
    expect(skillFile?.content).toBe('# Test Skill\n\nThis is a test skill for e2e tests.');
  });

  // -------------------------------------------------------------------------
  // 6. Batch endpoint accepts multiple changes
  // -------------------------------------------------------------------------

  it('batch endpoint accepts multiple changes', async () => {
    const batchRoute = await importBatchRoute();
    const draftsRoute = await importDraftsRoute();

    const response = await batchRoute.POST(
      makeRequest('/api/studio/drafts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [
            { path: 'skills/batch-1.md', action: 'upsert', content: 'Batch skill 1' },
            { path: 'skills/batch-2.md', action: 'upsert', content: 'Batch skill 2' },
            { path: 'knowledge/batch-k.md', action: 'upsert', content: 'Batch knowledge' },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await parseJson(response) as { accepted: number };
    expect(body.accepted).toBe(3);

    // Verify drafts were created
    const listResponse = await draftsRoute.GET(makeRequest('/api/studio/drafts'));
    const listBody = await parseJson(listResponse) as { drafts: Array<{ filePath: string }> };
    const draftPaths = listBody.drafts.map(d => d.filePath);
    expect(draftPaths).toContain('skills/batch-1.md');
    expect(draftPaths).toContain('skills/batch-2.md');
    expect(draftPaths).toContain('knowledge/batch-k.md');

    // Clean up for subsequent tests
    const discardRoute = await importDiscardRoute();
    await discardRoute.POST(makeRequest('/api/studio/discard', { method: 'POST' }));
  });

  // -------------------------------------------------------------------------
  // 7. Path traversal is rejected
  // -------------------------------------------------------------------------

  it('rejects path traversal attempts', async () => {
    const fileRoute = await importDraftFileRoute();

    const response = await fileRoute.PUT(
      makeRequest('/api/studio/drafts/../../etc/passwd', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'malicious content' }),
      }),
      makeRouteParams('../../etc/passwd'),
    );

    expect(response.status).toBe(400);
    const body = await parseJson(response) as { error: { code: string } };
    expect(body.error.code).toBe('STUDIO_PATH_ERROR');
  });

  // -------------------------------------------------------------------------
  // 8. Null byte injection is rejected
  // -------------------------------------------------------------------------

  it('rejects null byte injection', async () => {
    const fileRoute = await importDraftFileRoute();

    const response = await fileRoute.PUT(
      makeRequest('/api/studio/drafts/skills/test%00.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'null byte content' }),
      }),
      // The catch-all param receives the decoded path segments
      { params: Promise.resolve({ filePath: ['skills', 'test\0.md'] }) },
    );

    expect(response.status).toBe(400);
    const body = await parseJson(response) as { error: { code: string } };
    expect(body.error.code).toBe('STUDIO_PATH_ERROR');
  });

  // -------------------------------------------------------------------------
  // 9. Preview returns 501
  // -------------------------------------------------------------------------

  it('preview returns 501 Not Implemented', async () => {
    const { POST } = await importPreviewRoute();
    const response = await POST(makeRequest('/api/studio/preview', { method: 'POST' }));

    expect(response.status).toBe(501);
    const body = await parseJson(response) as { error: { code: string } };
    expect(body.error.code).toBe('STUDIO_FEATURE_UNAVAILABLE');
  });

  // -------------------------------------------------------------------------
  // 10. CORS headers present
  // -------------------------------------------------------------------------

  it('includes CORS headers for allowed origins', async () => {
    const { GET } = await importDraftsRoute();

    const response = await GET(
      makeRequest('/api/studio/drafts', {
        headers: { Origin: 'http://test-origin.example.com' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://test-origin.example.com',
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('rejects requests from disallowed origins', async () => {
    const { GET } = await importDraftsRoute();

    const response = await GET(
      makeRequest('/api/studio/drafts', {
        headers: { Origin: 'http://evil.example.com' },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('returns CORS preflight headers for OPTIONS', async () => {
    const { OPTIONS } = await importDraftsRoute();

    const response = OPTIONS(
      makeRequest('/api/studio/drafts', {
        method: 'OPTIONS',
        headers: { Origin: 'http://test-origin.example.com' },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://test-origin.example.com',
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
