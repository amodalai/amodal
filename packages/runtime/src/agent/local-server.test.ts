/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {createLocalServer} from './local-server.js';

// Use vi.hoisted so mocks survive vi.restoreAllMocks() from global test-setup
const {mockLoadRepo, mockSetupSession, mockPrepareExploreConfig, mockPlanModeManager} = vi.hoisted(() => ({
  mockLoadRepo: vi.fn(),
  mockSetupSession: vi.fn(),
  mockPrepareExploreConfig: vi.fn(),
  mockPlanModeManager: vi.fn(),
}));

vi.mock('@amodalai/core', () => ({
  loadRepo: mockLoadRepo,
  setupSession: mockSetupSession,
  prepareExploreConfig: mockPrepareExploreConfig,
  PlanModeManager: mockPlanModeManager,
  extractRoles: vi.fn(() => []),
  buildConnectionsMap: vi.fn(() => ({})),
  buildDefaultPrompt: vi.fn(() => 'You are test agent.'),
  resolveScopeLabels: vi.fn(() => ({scopeLabels: {}})),
  generateFieldGuidance: vi.fn(() => ''),
  generateAlternativeLookupGuidance: vi.fn(() => ''),
  getModelContextWindow: vi.fn(() => 200_000),
}));

const MOCK_REPO = {
  source: 'local',
  origin: '/test',
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
    userRoles: [],
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
      repoPath: '/test',
      port: 0,
    });

    expect(server).toBeDefined();
    expect(server.app).toBeDefined();
    expect(typeof server.start).toBe('function');
    expect(typeof server.stop).toBe('function');
  });

  it('should respond to health checks', async () => {
    const server = await createLocalServer({
      repoPath: '/test',
      port: 0,
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      mode: 'repo',
      repo_path: '/test',
    });
  });

  it('should start and stop cleanly', async () => {
    const server = await createLocalServer({
      repoPath: '/test',
      port: 0,
      host: '127.0.0.1',
    });

    const httpServer = await server.start();
    expect(httpServer).toBeDefined();

    await server.stop();
  });

  it('should respond to inspect endpoint', async () => {
    const server = await createLocalServer({
      repoPath: '/test',
      port: 0,
    });

    const {default: request} = await import('supertest');
    const res = await request(server.app).get('/inspect/context');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('repo_path', '/test');
    expect(res.body).toHaveProperty('connections');
    expect(res.body).toHaveProperty('skills');
    expect(res.body).toHaveProperty('knowledge');
  });
});
