/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Cross-service smoke tests for the studio-standalone architecture.
 *
 * These tests verify:
 * 1. Runtime isolation — studio/admin routes are NOT served by the runtime
 * 2. /api/context returns service URLs based on config
 * 3. Context router works correctly in isolation
 */

import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// ---------------------------------------------------------------------------
// Shared temp dir for tests that need a repo path
// ---------------------------------------------------------------------------

const TEST_REPO = mkdtempSync(join(tmpdir(), 'amodal-studio-integ-'));
afterAll(() => {
  rmSync(TEST_REPO, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// Mocks — same pattern as local-server.test.ts
// ---------------------------------------------------------------------------

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
    name: 'test-studio',
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

// ---------------------------------------------------------------------------
// 1. Runtime isolation tests
// ---------------------------------------------------------------------------

describe('runtime isolation — studio/admin routes are absent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyMockImplementations();
  });

  it('GET /api/studio/drafts returns 404 (runtime does not serve studio routes)', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({repoPath: TEST_REPO, port: 0});
    const {default: request} = await import('supertest');

    const res = await request(server.app).get('/api/studio/drafts');
    expect(res.status).toBe(404);

    await server.stop();
  });

  it('POST /admin-chat returns 404 (admin chat endpoint is gone)', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({repoPath: TEST_REPO, port: 0});
    const {default: request} = await import('supertest');

    const res = await request(server.app)
      .post('/admin-chat')
      .send({message: 'hello'});
    expect(res.status).toBe(404);

    await server.stop();
  });

  it('POST /api/studio/publish returns 404', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({repoPath: TEST_REPO, port: 0});
    const {default: request} = await import('supertest');

    const res = await request(server.app)
      .post('/api/studio/publish')
      .send({commitMessage: 'test'});
    expect(res.status).toBe(404);

    await server.stop();
  });

  it('GET /api/studio/workspace returns 404', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({repoPath: TEST_REPO, port: 0});
    const {default: request} = await import('supertest');

    const res = await request(server.app).get('/api/studio/workspace');
    expect(res.status).toBe(404);

    await server.stop();
  });

  it('POST /api/studio/discard returns 404', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({repoPath: TEST_REPO, port: 0});
    const {default: request} = await import('supertest');

    const res = await request(server.app).post('/api/studio/discard');
    expect(res.status).toBe(404);

    await server.stop();
  });

  it('POST /api/studio/preview returns 404', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({repoPath: TEST_REPO, port: 0});
    const {default: request} = await import('supertest');

    const res = await request(server.app).post('/api/studio/preview');
    expect(res.status).toBe(404);

    await server.stop();
  });

  it('runtime still serves its own routes (health check)', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({repoPath: TEST_REPO, port: 0});
    const {default: request} = await import('supertest');

    const res = await request(server.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({status: 'ok', mode: 'repo'});

    await server.stop();
  });
});

// ---------------------------------------------------------------------------
// 2. /api/context endpoint tests
// ---------------------------------------------------------------------------

describe('/api/context returns service URLs from config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyMockImplementations();
  });

  it('returns studioUrl and adminAgentUrl when configured', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
      studioUrl: 'http://localhost:3848',
      adminAgentUrl: 'http://localhost:3849',
    });
    const {default: request} = await import('supertest');

    const res = await request(server.app).get('/api/context');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      studioUrl: 'http://localhost:3848',
      adminAgentUrl: 'http://localhost:3849',
    });

    await server.stop();
  });

  it('returns null when service URLs are not configured', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    const originalStudio = process.env['STUDIO_URL'];
    const originalAdmin = process.env['ADMIN_AGENT_URL'];
    delete process.env['STUDIO_URL'];
    delete process.env['ADMIN_AGENT_URL'];

    try {
      const server = await createLocalServer({
        repoPath: TEST_REPO,
        port: 0,
      });
      const {default: request} = await import('supertest');

      const res = await request(server.app).get('/api/context');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        studioUrl: null,
        adminAgentUrl: null,
      });

      await server.stop();
    } finally {
      if (originalStudio !== undefined) process.env['STUDIO_URL'] = originalStudio;
      if (originalAdmin !== undefined) process.env['ADMIN_AGENT_URL'] = originalAdmin;
    }
  });

  it('falls back to STUDIO_URL env var when config option is not set', async () => {
    const {createLocalServer} = await import('../agent/local-server.js');
    process.env['STUDIO_URL'] = 'http://env-studio:3848';
    process.env['ADMIN_AGENT_URL'] = 'http://env-admin:3849';

    try {
      const server = await createLocalServer({
        repoPath: TEST_REPO,
        port: 0,
      });
      const {default: request} = await import('supertest');

      const res = await request(server.app).get('/api/context');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        studioUrl: 'http://env-studio:3848',
        adminAgentUrl: 'http://env-admin:3849',
      });

      await server.stop();
    } finally {
      delete process.env['STUDIO_URL'];
      delete process.env['ADMIN_AGENT_URL'];
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Context router unit tests (isolated, no local-server overhead)
// ---------------------------------------------------------------------------

describe('createContextRouter — unit', () => {
  it('serves the configured URLs at /api/context', async () => {
    const express = await import('express');
    const {createContextRouter} = await import('../agent/routes/context.js');
    const {default: request} = await import('supertest');

    const app = express.default();
    app.use(createContextRouter({
      studioUrl: 'http://studio:3848',
      adminAgentUrl: 'http://admin:3849',
    }));

    const res = await request(app).get('/api/context');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      studioUrl: 'http://studio:3848',
      adminAgentUrl: 'http://admin:3849',
    });
  });

  it('returns nulls when no URLs configured', async () => {
    const express = await import('express');
    const {createContextRouter} = await import('../agent/routes/context.js');
    const {default: request} = await import('supertest');

    const app = express.default();
    app.use(createContextRouter({
      studioUrl: null,
      adminAgentUrl: null,
    }));

    const res = await request(app).get('/api/context');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      studioUrl: null,
      adminAgentUrl: null,
    });
  });
});
