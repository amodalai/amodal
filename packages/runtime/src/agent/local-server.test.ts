/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalServer} from './local-server.js';

// Use a real temp dir so PGLite session store can create its data files.
const TEST_REPO = mkdtempSync(join(tmpdir(), 'amodal-server-test-'));
afterAll(() => { rmSync(TEST_REPO, {recursive: true, force: true}); });

// Use vi.hoisted so mocks survive vi.restoreAllMocks() from global test-setup
const {mockLoadRepo, mockSetupSession, mockPrepareExploreConfig, mockPlanModeManager} = vi.hoisted(() => ({
  mockLoadRepo: vi.fn(),
  mockSetupSession: vi.fn(),
  mockPrepareExploreConfig: vi.fn(),
  mockPlanModeManager: vi.fn(),
}));

vi.mock('@amodalai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@amodalai/core')>();
  return {
    ...actual,
    loadRepo: mockLoadRepo,
    setupSession: mockSetupSession,
    prepareExploreConfig: mockPrepareExploreConfig,
    PlanModeManager: mockPlanModeManager,
    buildConnectionsMap: vi.fn(() => ({})),
    buildDefaultPrompt: vi.fn(() => 'You are test agent.'),
    generateFieldGuidance: vi.fn(() => ''),
    generateAlternativeLookupGuidance: vi.fn(() => ''),
    getModelContextWindow: vi.fn(() => 200_000),
  };
});

const MOCK_REPO = {
  source: 'local',
  origin: TEST_REPO,
  config: {
    name: 'test',
    version: '1.0.0',
    models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
  },
  connections: new Map(),
  skills: [],
  agents: {},
  automations: [],
  knowledge: [],
  evals: [],
  tools: [],
  stores: [],
};

function applyMockImplementations(): void {
  mockLoadRepo.mockResolvedValue(MOCK_REPO);
  mockSetupSession.mockReturnValue({
    repo: {connections: new Map(), skills: [], automations: [], knowledge: [], evals: [], tools: [], stores: []},
    scrubTracker: {},
    fieldScrubber: {},
    outputGuard: {},
    actionGate: {evaluate: vi.fn()},
    contextCompiler: {},
    compiledContext: {systemPrompt: 'test', tokenUsage: {total: 100000, used: 500, remaining: 99500, sectionBreakdown: {}}, sections: []},
    exploreContext: {systemPrompt: 'explore', tokenUsage: {total: 100000, used: 300, remaining: 99700, sectionBreakdown: {}}, sections: []},
    outputPipeline: {process: vi.fn(), createStreamProcessor: vi.fn()},
    telemetry: {logScrub: vi.fn(), logGuard: vi.fn(), logGate: vi.fn()},
    connectionsMap: {},
    sessionId: 'test',
    isDelegated: false,
  });
  mockPrepareExploreConfig.mockReturnValue({
    systemPrompt: 'explore',
    model: {provider: 'anthropic', model: 'test'},
    connectionsMap: {},
    readOnly: true,
    maxTurns: 10,
    maxDepth: 2,
  });
  mockPlanModeManager.mockImplementation(() => ({
    isActive: vi.fn(() => false),
    enter: vi.fn(),
    exit: vi.fn(),
    getPlanningReminder: vi.fn(() => null),
    getApprovedPlanContext: vi.fn(() => null),
  }));
}

describe('createLocalServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyMockImplementations();
  });

  it('should create a server instance', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    expect(server).toBeDefined();
    expect(server.app).toBeDefined();
    expect(typeof server.start).toBe('function');
    expect(typeof server.stop).toBe('function');
  });

  it('should respond to health checks', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      mode: 'repo',
      repo_path: TEST_REPO,
    });
  });

  it('should start and stop cleanly', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
      host: '127.0.0.1',
    });

    const httpServer = await server.start();
    expect(httpServer).toBeDefined();

    await server.stop();
  });

  it('should respond to inspect endpoint', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/inspect/context');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('repo_path', TEST_REPO);
    expect(res.body).toHaveProperty('connections');
    expect(res.body).toHaveProperty('skills');
    expect(res.body).toHaveProperty('knowledge');
  });

  it('GET /api/me returns ops by default in amodal dev', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({id: 'local-dev', role: 'ops'});
  });

  it('GET /api/me uses a custom roleProvider when provided', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
      roleProvider: {
        async resolveUser() {
          return {id: 'custom-user', role: 'admin'};
        },
      },
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({id: 'custom-user', role: 'admin'});
  });

  // -------------------------------------------------------------------------
  // Studio routes (PR 2.8) — smoke tests that the router is mounted on the
  // app returned by createLocalServer and a fresh in-memory pglite backend
  // round-trips list -> put -> list -> publish correctly.
  //
  // We exercise the FULL mounted router (not a standalone createStudioRouter
  // call) because the single-shared-instance concern in PR 2.8 is exactly
  // about wiring inside createLocalServer — a standalone router test would
  // miss any regression where the wiring is duplicated or skipped.
  // -------------------------------------------------------------------------

  it('GET /api/studio/drafts returns an empty list on a fresh server', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });
    try {
      const {default: request} = await import('supertest');
      const res = await request(server.app).get('/api/studio/drafts');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({drafts: []});
    } finally {
      await server.stop();
    }
  });

  it('PUT /api/studio/drafts then GET lists the saved draft', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });
    try {
      const {default: request} = await import('supertest');

      const putRes = await request(server.app)
        .put('/api/studio/drafts/skills/test.md')
        .set('Content-Type', 'application/json')
        .send({content: 'hello world'});
      expect(putRes.status).toBe(200);
      expect(putRes.body).toMatchObject({status: 'ok', filePath: 'skills/test.md'});

      const listRes = await request(server.app).get('/api/studio/drafts');
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.drafts)).toBe(true);
      expect(listRes.body.drafts).toHaveLength(1);
      expect(listRes.body.drafts[0]).toMatchObject({
        filePath: 'skills/test.md',
        content: 'hello world',
      });
    } finally {
      await server.stop();
    }
  });

  it('POST /api/studio/publish writes drafts to disk and returns a local- SHA', async () => {
    // Use a fresh repo dir for this test — publish writes real files to disk.
    const publishRepo = mkdtempSync(join(tmpdir(), 'amodal-studio-publish-'));
    try {
      const server = await createLocalServer({
        repoPath: publishRepo,
        port: 0,
      });
      try {
        const {default: request} = await import('supertest');
        await request(server.app)
          .put('/api/studio/drafts/skills/published.md')
          .set('Content-Type', 'application/json')
          .send({content: '# published'})
          .expect(200);

        const publishRes = await request(server.app)
          .post('/api/studio/publish')
          .set('Content-Type', 'application/json')
          .send({commitMessage: 'test publish'});
        expect(publishRes.status).toBe(200);
        expect(typeof publishRes.body.commitSha).toBe('string');
        expect(publishRes.body.commitSha).toMatch(/^local-/);

        const onDisk = join(publishRepo, 'skills', 'published.md');
        expect(existsSync(onDisk)).toBe(true);
        expect(readFileSync(onDisk, 'utf-8')).toBe('# published');

        // Drafts should be cleared after publish.
        const afterRes = await request(server.app).get('/api/studio/drafts');
        expect(afterRes.status).toBe(200);
        expect(afterRes.body).toEqual({drafts: []});
      } finally {
        await server.stop();
      }
    } finally {
      rmSync(publishRepo, {recursive: true, force: true});
    }
  });

  it('GET /api/me returns 401 when custom roleProvider returns null', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
      roleProvider: {
        async resolveUser() {
          return null;
        },
      },
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/api/me');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {code: 'unauthenticated', message: 'Authentication required'},
    });
  });
});
