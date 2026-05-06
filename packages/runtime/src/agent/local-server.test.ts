/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalServer} from './local-server.js';

// Use a real temp dir for the test repo path.
const TEST_REPO = mkdtempSync(join(tmpdir(), 'amodal-server-test-'));
const CONNECTION_PACKAGES_API_PATH = '/api/connection-packages';
const REMOVED_GETTING_STARTED_API_PATH = '/api/getting-started';
afterAll(() => { rmSync(TEST_REPO, {recursive: true, force: true}); });

// Use vi.hoisted so mocks survive vi.restoreAllMocks() from global test-setup
const {mockLoadRepo, mockSetupSession, mockPrepareExploreConfig, mockPlanModeManager} = vi.hoisted(() => ({
  mockLoadRepo: vi.fn(),
  mockSetupSession: vi.fn(),
  mockPrepareExploreConfig: vi.fn(),
  mockPlanModeManager: vi.fn(),
}));

// Mock @amodalai/db so tests don't need a real Postgres connection
const noopChain = () => ({set: noopChain, where: noopChain, execute: vi.fn(async () => ({}))});
vi.mock('@amodalai/db', () => ({
  getDb: vi.fn(() => ({
    update: noopChain,
    execute: vi.fn(async () => ({})),
  })),
  ensureSchema: vi.fn(async () => {}),
  closeDb: vi.fn(async () => {}),
  eq: vi.fn(),
  sql: Object.assign(vi.fn(), {raw: vi.fn()}),
  agentSessions: {},
  channelSessions: {},
  storeDocuments: {appId: 'app_id'},
  storeDocumentVersions: {appId: 'app_id'},
  agentMemoryEntries: {appId: 'app_id'},
  feedback: {},
  evalRuns: {},
  studioDrafts: {},
  notifyStoreUpdated: vi.fn(async () => {}),
  notifySessionUpdated: vi.fn(async () => {}),
  notifyFeedbackCreated: vi.fn(async () => {}),
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
    McpManager: class {
      connectedCount = 0;
      async startServers() {}
      getDiscoveredTools() { return []; }
      getServerInfo() { return []; }
      async shutdown() {}
    },
  };
});

const DEFAULT_MOCK_CONFIG = {
  name: 'test',
  version: '1.0.0',
  models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
};

type MockConfig = typeof DEFAULT_MOCK_CONFIG & {
  embed?: {
    position: string;
    allowedDomains: string[];
  };
};

const MOCK_REPO = {
  source: 'local',
  origin: TEST_REPO,
  config: {...DEFAULT_MOCK_CONFIG} as MockConfig,
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
    MOCK_REPO.config = {...DEFAULT_MOCK_CONFIG};
    delete process.env['XPOZ_BEARER_TOKEN'];
    delete process.env['XPOZ_ENV'];
    delete process.env['TYPEFULLY_API_KEY'];
    MOCK_REPO.connections = new Map();
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

  it('returns embed config from /api/config', async () => {
    MOCK_REPO.config = {
      ...MOCK_REPO.config,
      embed: {
        position: 'floating',
        allowedDomains: ['app.example.com'],
      },
    };
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.embed).toMatchObject({
      position: 'floating',
      allowedDomains: ['app.example.com'],
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

  it('reports credential status for directory-based MCP connections', async () => {
    process.env['XPOZ_BEARER_TOKEN'] = 'test-token';
    delete process.env['XPOZ_ENV'];
    MOCK_REPO.connections.set('xpoz-mcp', {
      name: 'xpoz-mcp',
      spec: {
        protocol: 'mcp',
        transport: 'http',
        url: 'https://mcp.xpoz.ai/mcp',
        headers: {Authorization: 'env:XPOZ_BEARER_TOKEN'},
        env: {XPOZ_RUNTIME_ENV: 'env:XPOZ_ENV'},
      },
      access: {endpoints: {}},
      surface: [],
      location: join(TEST_REPO, 'connections', 'xpoz-mcp'),
    });

    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    const {default: request} = await import('supertest');
    const started = await request(server.app).get(CONNECTION_PACKAGES_API_PATH);
    expect(started.status).toBe(200);
    expect(started.body.packages).toEqual([
      expect.objectContaining({
        connectionName: 'xpoz-mcp',
        name: 'xpoz-mcp',
        displayName: 'xpoz-mcp',
        isFulfilled: false,
        envVars: [
          {name: 'XPOZ_BEARER_TOKEN', description: 'Header: Authorization', set: true},
          {name: 'XPOZ_ENV', description: 'Environment: XPOZ_RUNTIME_ENV', set: false},
        ],
      }),
    ]);

    const detail = await request(server.app).get('/api/connections/xpoz-mcp');
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      name: 'xpoz-mcp',
      displayName: 'xpoz-mcp',
      category: 'local',
      authType: 'mcp',
      oauth: null,
      envVars: [
        {name: 'XPOZ_BEARER_TOKEN', description: 'Header: Authorization', set: true},
        {name: 'XPOZ_ENV', description: 'Environment: XPOZ_RUNTIME_ENV', set: false},
      ],
    });
  });

  it('reports package metadata under the runtime connection name', async () => {
    process.env['TYPEFULLY_API_KEY'] = 'test-token';
    const packageDir = join(TEST_REPO, 'amodal_packages', '.npm', 'node_modules', '@amodalai', 'connection-typefully');
    mkdirSync(packageDir, {recursive: true});
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: '@amodalai/connection-typefully',
      amodal: {
        displayName: 'Typefully',
        auth: {
          envVars: {
            TYPEFULLY_API_KEY: 'Typefully API key',
          },
        },
      },
    }));
    MOCK_REPO.connections.set('typefully', {
      name: 'typefully',
      spec: {
        protocol: 'rest',
        baseUrl: 'https://api.typefully.com/v2',
        auth: {type: 'bearer', token: 'env:TYPEFULLY_API_KEY'},
      },
      access: {endpoints: {}},
      surface: [],
      location: join(packageDir, 'connections', 'typefully'),
    });

    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    const {default: request} = await import('supertest');
    const started = await request(server.app).get(CONNECTION_PACKAGES_API_PATH);

    expect(started.status).toBe(200);
    expect(started.body.packages).toEqual([
      expect.objectContaining({
        connectionName: 'typefully',
        name: '@amodalai/connection-typefully',
        displayName: 'Typefully',
        isFulfilled: true,
      }),
    ]);
  });

  it('does not expose the old getting-started metadata route', async () => {
    const server = await createLocalServer({
      repoPath: TEST_REPO,
      port: 0,
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get(REMOVED_GETTING_STARTED_API_PATH);

    expect(res.status).toBe(404);
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
