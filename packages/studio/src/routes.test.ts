/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Integration tests for `createStudioRouter`.
 *
 * These tests exercise the HTTP boundary only — routing, auth gating, body
 * parsing, path validation, and error-class-to-status mapping. Backend
 * behavior (draft persistence, publish semantics, etc.) is covered by the
 * contract suite in `backend-contract.ts` and the pglite tests.
 */

import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import express from 'express';
import type {Request} from 'express';
import supertest from 'supertest';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import type {StudioAuth, StudioAuthResult} from './auth.js';
import {createStudioRouter} from './routes.js';
import type {PGLiteStudioBackend} from './backends/pglite.js';
import {createPGLiteStudioBackend} from './backends/pglite.js';

// Auth stubs covering the three states the router cares about.
const allowAuth: StudioAuth = {
  async authorize(_req: Request): Promise<StudioAuthResult> {
    return {ok: true, user: {userId: 'test-user', role: 'ops'}};
  },
};

const denyAuthUnauth: StudioAuth = {
  async authorize(_req: Request): Promise<StudioAuthResult> {
    return {ok: false, reason: 'unauthenticated'};
  },
};

const denyAuthForbidden: StudioAuth = {
  async authorize(_req: Request): Promise<StudioAuthResult> {
    return {ok: false, reason: 'forbidden'};
  },
};

const throwingAuth: StudioAuth = {
  async authorize(_req: Request): Promise<StudioAuthResult> {
    throw new Error('boom');
  },
};

function buildApp(backend: PGLiteStudioBackend, auth: StudioAuth) {
  const app = express();
  app.use(createStudioRouter({backend, auth}));
  return app;
}

let backend: PGLiteStudioBackend;
let repoPath: string;

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'studio-routes-'));
  backend = await createPGLiteStudioBackend({repoPath});
});

afterAll(async () => {
  await backend.close();
  await rm(repoPath, {recursive: true, force: true});
});

beforeEach(async () => {
  // Wipe all drafts so each test starts from a clean state.
  await backend.discardAll('test-user');
});

describe('createStudioRouter — auth gating', () => {
  it('returns 401 when auth reports unauthenticated', async () => {
    const app = buildApp(backend, denyAuthUnauth);
    const res = await supertest(app).get('/api/studio/drafts');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  it('returns 403 when auth reports forbidden', async () => {
    const app = buildApp(backend, denyAuthForbidden);
    const res = await supertest(app).get('/api/studio/drafts');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 500 when auth.authorize throws', async () => {
    const app = buildApp(backend, throwingAuth);
    const res = await supertest(app).get('/api/studio/drafts');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('auth_failed');
  });

  it('gates every route — PUT denied without auth', async () => {
    const app = buildApp(backend, denyAuthUnauth);
    const res = await supertest(app)
      .put('/api/studio/drafts/skills/a.md')
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(401);
  });

  it('gates every route — POST publish denied without auth', async () => {
    const app = buildApp(backend, denyAuthForbidden);
    const res = await supertest(app)
      .post('/api/studio/publish')
      .send({commitMessage: 'x'});
    expect(res.status).toBe(403);
  });
});

describe('GET /api/studio/drafts', () => {
  it('returns an empty list for a new user', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).get('/api/studio/drafts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({drafts: []});
  });

  it('returns staged drafts', async () => {
    await backend.setDraft('test-user', 'skills/pricing.md', 'hello');
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).get('/api/studio/drafts');
    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].filePath).toBe('skills/pricing.md');
    expect(res.body.drafts[0].content).toBe('hello');
    expect(typeof res.body.drafts[0].updatedAt).toBe('string');
  });
});

describe('PUT /api/studio/drafts/*', () => {
  it('saves a draft from a text/plain body', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app)
      .put('/api/studio/drafts/skills/pricing.md')
      .set('Content-Type', 'text/plain')
      .send('content from text body');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({status: 'ok', filePath: 'skills/pricing.md'});
    const stored = await backend.getDraft('test-user', 'skills/pricing.md');
    expect(stored).toBe('content from text body');
  });

  it('saves a draft from a JSON {content} body', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app)
      .put('/api/studio/drafts/skills/other.md')
      .send({content: 'content from json body'});
    expect(res.status).toBe(200);
    expect(res.body.filePath).toBe('skills/other.md');
    const stored = await backend.getDraft('test-user', 'skills/other.md');
    expect(stored).toBe('content from json body');
  });

  it('returns 400 when JSON body is missing content', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app)
      .put('/api/studio/drafts/skills/bad.md')
      .send({notContent: 'nope'});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  it('rejects a path with `..` segments', async () => {
    const app = buildApp(backend, allowAuth);
    // URL-encode the separator so Express's URL layer does not normalize the
    // `..` segments away before we get to see them.
    const res = await supertest(app)
      .put('/api/studio/drafts/skills%2F..%2F..%2Fetc%2Fpasswd')
      .set('Content-Type', 'text/plain')
      .send('pwn');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  it('rejects a null-byte path', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app)
      .put(`/api/studio/drafts/skills/foo${encodeURIComponent('\0')}bar.md`)
      .set('Content-Type', 'text/plain')
      .send('x');
    expect(res.status).toBe(400);
  });

  it('URL-decodes the path suffix', async () => {
    const app = buildApp(backend, allowAuth);
    // `skills/pricing%20v2.md` should decode to `skills/pricing v2.md`
    const res = await supertest(app)
      .put('/api/studio/drafts/skills/pricing%20v2.md')
      .set('Content-Type', 'text/plain')
      .send('spaced');
    expect(res.status).toBe(200);
    const stored = await backend.getDraft('test-user', 'skills/pricing v2.md');
    expect(stored).toBe('spaced');
  });
});

describe('DELETE /api/studio/drafts/*', () => {
  it('deletes a staged draft', async () => {
    await backend.setDraft('test-user', 'skills/to-delete.md', 'bye');
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).delete(
      '/api/studio/drafts/skills/to-delete.md',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      filePath: 'skills/to-delete.md',
    });
    const stored = await backend.getDraft('test-user', 'skills/to-delete.md');
    expect(stored).toBeNull();
  });

  it('is idempotent when the draft does not exist', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).delete('/api/studio/drafts/skills/ghost.md');
    expect(res.status).toBe(200);
  });

  it('rejects a bad path before hitting the backend', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).delete(
      '/api/studio/drafts/skills%2F..%2Fescape.md',
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/studio/discard', () => {
  it('returns count 0 when there are no drafts', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).post('/api/studio/discard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({status: 'ok', count: 0});
  });

  it('discards all drafts and reports the count', async () => {
    await backend.setDraft('test-user', 'skills/a.md', 'a');
    await backend.setDraft('test-user', 'skills/b.md', 'b');
    await backend.setDraft('test-user', 'knowledge/c.md', 'c');
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).post('/api/studio/discard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({status: 'ok', count: 3});
    const after = await backend.listDrafts('test-user');
    expect(after).toHaveLength(0);
  });
});

describe('POST /api/studio/publish', () => {
  it('returns 400 when commitMessage is missing', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).post('/api/studio/publish').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  it('returns 400 when commitMessage is empty', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app)
      .post('/api/studio/publish')
      .send({commitMessage: ''});
    expect(res.status).toBe(400);
  });

  it('publishes drafts and returns PublishResult shape', async () => {
    await backend.setDraft('test-user', 'skills/publish-me.md', 'published!');
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app)
      .post('/api/studio/publish')
      .send({commitMessage: 'initial publish'});
    expect(res.status).toBe(200);
    expect(typeof res.body.commitSha).toBe('string');
    expect(res.body.commitSha.startsWith('local-')).toBe(true);
    // Confirm the file landed on the temp repo filesystem.
    const written = await readFile(
      join(repoPath, 'skills', 'publish-me.md'),
      'utf8',
    );
    expect(written).toBe('published!');
    // Drafts should be cleared.
    const after = await backend.listDrafts('test-user');
    expect(after).toHaveLength(0);
  });

  it('publishes with no drafts as a no-op', async () => {
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app)
      .post('/api/studio/publish')
      .send({commitMessage: 'nothing to do'});
    expect(res.status).toBe(200);
    expect(typeof res.body.commitSha).toBe('string');
  });
});

describe('POST /api/studio/preview', () => {
  it('returns 501 when the backend throws StudioFeatureUnavailableError', async () => {
    // PGLiteStudioBackend.buildPreview throws StudioFeatureUnavailableError
    // in PR 2.2, so this test covers the 501 mapping path.
    const app = buildApp(backend, allowAuth);
    const res = await supertest(app).post('/api/studio/preview').send({});
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('feature_unavailable');
    expect(res.body.feature).toBe('buildPreview');
  });
});

describe('body size limits', () => {
  it('rejects an oversized text/plain body with 413', async () => {
    const app = buildApp(backend, allowAuth);
    // 3 MiB of `a` — body parser cap is 2 MiB.
    const huge = 'a'.repeat(3 * 1024 * 1024);
    const res = await supertest(app)
      .put('/api/studio/drafts/skills/huge.md')
      .set('Content-Type', 'text/plain')
      .send(huge);
    expect(res.status).toBe(413);
  });
});
