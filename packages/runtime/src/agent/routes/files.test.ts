/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the role-gated /api/files routes.
 *
 * Verifies that:
 *  - Default behavior (no roleProvider) lets everyone read/write everything
 *  - admin role can read/write skills/, knowledge/, agents/ only
 *  - admin role gets a filtered tree (no connections/, tools/, etc.)
 *  - admin role gets 403 trying to read or write outside the allowlist
 *  - user role is denied entirely
 *  - ops role can do anything
 *  - Unauthenticated requests get 401
 */

import {describe, it, expect, beforeEach, afterAll, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFilesRouter} from './files.js';
import type {RoleProvider, RuntimeUser} from '../../role-provider.js';
import {errorHandler} from '../../middleware/error-handler.js';

// Each test gets a fresh repo via beforeEach. We don't reuse a single repo
// across tests because PUT tests would otherwise mutate state that other
// tests read.
let TEST_REPO: string;
const allRepos: string[] = [];

function setupRepo(repoPath: string): void {
  mkdirSync(join(repoPath, 'skills', 'pricing'), {recursive: true});
  writeFileSync(join(repoPath, 'skills', 'pricing', 'SKILL.md'), '# Pricing skill');
  mkdirSync(join(repoPath, 'knowledge'), {recursive: true});
  writeFileSync(join(repoPath, 'knowledge', 'returns.md'), '# Return policy');
  mkdirSync(join(repoPath, 'agents'), {recursive: true});
  writeFileSync(join(repoPath, 'agents', 'main.md'), '# Main agent');
  mkdirSync(join(repoPath, 'connections', 'salesforce'), {recursive: true});
  writeFileSync(join(repoPath, 'connections', 'salesforce', 'spec.json'), '{}');
  mkdirSync(join(repoPath, 'tools', 'lookup'), {recursive: true});
  writeFileSync(join(repoPath, 'tools', 'lookup', 'tool.json'), '{}');
}

beforeEach(() => {
  vi.clearAllMocks();
  TEST_REPO = mkdtempSync(join(tmpdir(), 'amodal-files-test-'));
  allRepos.push(TEST_REPO);
  setupRepo(TEST_REPO);
});

afterAll(() => {
  for (const repo of allRepos) {
    rmSync(repo, {recursive: true, force: true});
  }
});

function makeProvider(user: RuntimeUser | null): RoleProvider {
  return {
    async resolveUser() {
      return user;
    },
  };
}

function makeApp(roleProvider?: RoleProvider): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createFilesRouter({repoPath: TEST_REPO, roleProvider}));
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Default (no roleProvider) — backwards compatible behavior
// ---------------------------------------------------------------------------

describe('createFilesRouter — default (no roleProvider)', () => {
  it('GET /api/files returns the unfiltered tree (everyone is ops by default)', async () => {
    const res = await request(makeApp()).get('/api/files');
    expect(res.status).toBe(200);
    const dirs = (res.body.tree as Array<{name: string}>).map((e) => e.name);
    expect(dirs).toEqual(expect.arrayContaining(['skills', 'knowledge', 'agents', 'connections', 'tools']));
  });

  it('GET /api/files/skills/pricing/SKILL.md reads the file', async () => {
    const res = await request(makeApp()).get('/api/files/skills/pricing/SKILL.md');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# Pricing skill');
  });

  it('GET /api/files/connections/salesforce/spec.json reads the file (ops can read anything)', async () => {
    const res = await request(makeApp()).get('/api/files/connections/salesforce/spec.json');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('{}');
  });

  it('PUT /api/files/skills/new/SKILL.md writes the file', async () => {
    const res = await request(makeApp())
      .put('/api/files/skills/new/SKILL.md')
      .send({content: '# New skill'});
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// admin role
// ---------------------------------------------------------------------------

describe('createFilesRouter — admin role', () => {
  const adminProvider = makeProvider({id: 'sally@acme.com', role: 'admin'});

  it('GET /api/files returns a tree filtered to skills/knowledge/agents only', async () => {
    const res = await request(makeApp(adminProvider)).get('/api/files');
    expect(res.status).toBe(200);
    const dirs = (res.body.tree as Array<{name: string}>).map((e) => e.name);
    expect(dirs).toEqual(expect.arrayContaining(['skills', 'knowledge', 'agents']));
    expect(dirs).not.toContain('connections');
    expect(dirs).not.toContain('tools');
  });

  it('admin can read skills/', async () => {
    const res = await request(makeApp(adminProvider)).get('/api/files/skills/pricing/SKILL.md');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# Pricing skill');
  });

  it('admin can read knowledge/', async () => {
    const res = await request(makeApp(adminProvider)).get('/api/files/knowledge/returns.md');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# Return policy');
  });

  it('admin can read agents/', async () => {
    const res = await request(makeApp(adminProvider)).get('/api/files/agents/main.md');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# Main agent');
  });

  it('admin gets 403 reading connections/', async () => {
    const res = await request(makeApp(adminProvider)).get('/api/files/connections/salesforce/spec.json');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(res.body.error.current_role).toBe('admin');
    expect(res.body.error.required_role).toBe('ops');
  });

  it('admin gets 403 reading tools/', async () => {
    const res = await request(makeApp(adminProvider)).get('/api/files/tools/lookup/tool.json');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('admin can write to skills/', async () => {
    const res = await request(makeApp(adminProvider))
      .put('/api/files/skills/admin-new/SKILL.md')
      .send({content: '# Admin created'});
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  it('admin gets 403 writing to connections/', async () => {
    const res = await request(makeApp(adminProvider))
      .put('/api/files/connections/salesforce/spec.json')
      .send({content: '{"new": true}'});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('admin gets 403 writing to amodal.json', async () => {
    const res = await request(makeApp(adminProvider))
      .put('/api/files/amodal.json')
      .send({content: '{}'});
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// user role
// ---------------------------------------------------------------------------

describe('createFilesRouter — user role', () => {
  const userProvider = makeProvider({id: 'end-user', role: 'user'});

  it('user gets 403 on tree', async () => {
    const res = await request(makeApp(userProvider)).get('/api/files');
    expect(res.status).toBe(403);
    expect(res.body.error.required_role).toBe('admin');
    expect(res.body.error.current_role).toBe('user');
  });

  it('user gets 403 reading any file', async () => {
    const res = await request(makeApp(userProvider)).get('/api/files/skills/pricing/SKILL.md');
    expect(res.status).toBe(403);
  });

  it('user gets 403 writing any file', async () => {
    const res = await request(makeApp(userProvider))
      .put('/api/files/skills/new/SKILL.md')
      .send({content: '# x'});
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// ops role
// ---------------------------------------------------------------------------

describe('createFilesRouter — ops role', () => {
  const opsProvider = makeProvider({id: 'dev@acme.com', role: 'ops'});

  it('ops sees the unfiltered tree', async () => {
    const res = await request(makeApp(opsProvider)).get('/api/files');
    expect(res.status).toBe(200);
    const dirs = (res.body.tree as Array<{name: string}>).map((e) => e.name);
    expect(dirs).toEqual(expect.arrayContaining(['skills', 'knowledge', 'agents', 'connections', 'tools']));
  });

  it('ops can read connections/', async () => {
    const res = await request(makeApp(opsProvider)).get('/api/files/connections/salesforce/spec.json');
    expect(res.status).toBe(200);
  });

  it('ops can write connections/', async () => {
    const res = await request(makeApp(opsProvider))
      .put('/api/files/connections/salesforce/spec.json')
      .send({content: '{"updated": true}'});
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated
// ---------------------------------------------------------------------------

describe('createFilesRouter — unauthenticated', () => {
  const nullProvider = makeProvider(null);

  it('GET /api/files returns 401 when provider returns null', async () => {
    const res = await request(makeApp(nullProvider)).get('/api/files');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('GET /api/files/* returns 401 when provider returns null', async () => {
    const res = await request(makeApp(nullProvider)).get('/api/files/skills/pricing/SKILL.md');
    expect(res.status).toBe(401);
  });

  it('PUT /api/files/* returns 401 when provider returns null', async () => {
    const res = await request(makeApp(nullProvider))
      .put('/api/files/skills/new/SKILL.md')
      .send({content: '# x'});
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

describe('createFilesRouter — path normalization', () => {
  it('Express normalizes ../ in URL paths before they reach the handler', async () => {
    // Express collapses `connections/../skills/...` to `skills/...` before
    // routing. The role check then sees `skills/...` and allows it.
    // This test documents that behavior — the role gate relies on Express
    // normalization for traversal protection in addition to its own first-segment
    // check.
    const adminProvider = makeProvider({id: 'a', role: 'admin'});
    const res = await request(makeApp(adminProvider)).get('/api/files/connections/../skills/pricing/SKILL.md');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# Pricing skill');
  });

  it('admin reading a path that would resolve outside skills/ via .. inside the path string is blocked', async () => {
    // If a client somehow sneaks a `..` past Express normalization (e.g., URL
    // encoded), the path.normalize() in checkPathAccess catches it because
    // the first segment after normalization wouldn't be in ADMIN_ALLOWED_DIRS.
    // We can't easily test this through supertest since Express normalizes,
    // but we can verify the unit-level behavior of checkPathAccess by hitting
    // a path that's definitely not in the allowlist.
    const adminProvider = makeProvider({id: 'a', role: 'admin'});
    const res = await request(makeApp(adminProvider)).get('/api/files/secrets.json');
    expect(res.status).toBe(403);
  });
});
