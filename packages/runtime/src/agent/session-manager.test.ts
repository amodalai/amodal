/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AgentSessionManager} from './session-manager.js';
import type {AmodalRepo} from '@amodalai/core';

// Mock setupSession and friends
vi.mock('@amodalai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@amodalai/core')>();
  return {
    ...actual,
    setupSession: vi.fn(() => ({
      repo: makeRepo(),
      scrubTracker: {},
      fieldScrubber: {scrub: vi.fn()},
      outputGuard: {guard: vi.fn(() => ({output: '', modified: false, blocked: false, findings: []}))},
      actionGate: {evaluate: vi.fn(() => ({decision: 'allow', escalated: false, endpointPath: ''}))},
      contextCompiler: {},
      compiledContext: {systemPrompt: 'test', tokenUsage: {total: 100000, used: 500, remaining: 99500, sectionBreakdown: {}}, sections: []},
      exploreContext: {systemPrompt: 'explore', tokenUsage: {total: 100000, used: 300, remaining: 99700, sectionBreakdown: {}}, sections: []},
      outputPipeline: {process: vi.fn((t: string) => ({output: t, modified: false, blocked: false, findings: []})), createStreamProcessor: vi.fn()},
      telemetry: {logScrub: vi.fn(), logGuard: vi.fn(), logGate: vi.fn(), logExplore: vi.fn()},
      connectionsMap: {},
      userRoles: [],
      sessionId: 'test-session',
      isDelegated: false,
    })),
    prepareExploreConfig: vi.fn(() => ({
      systemPrompt: 'explore',
      model: {provider: 'anthropic', model: 'test'},
      connectionsMap: {},
      readOnly: true,
      maxTurns: 10,
      maxDepth: 2,
    })),
    PlanModeManager: vi.fn(() => ({
      isActive: vi.fn(() => false),
      getApprovedPlan: vi.fn(() => null),
      getReason: vi.fn(() => null),
      enter: vi.fn(),
      approve: vi.fn(),
      exit: vi.fn(),
      getPlanningReminder: vi.fn(() => null),
      getApprovedPlanContext: vi.fn(() => null),
    })),
    extractRoles: vi.fn(() => []),
    buildConnectionsMap: vi.fn(() => ({})),
  };
});

function makeRepo(): AmodalRepo {
  return {
    source: 'local',
    origin: '/test',
    config: {
      name: 'test',
      version: '1.0.0',
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
      },
    },
    connections: new Map(),
    skills: [],
    agents: {subagents: []},
    automations: [],
    knowledge: [],
    evals: [],
    tools: [],
    stores: [],
  };
}

describe('AgentSessionManager', () => {
  let manager: AgentSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new AgentSessionManager(makeRepo(), {ttlMs: 1000});
  });

  afterEach(async () => {
    await manager.shutdown();
    vi.useRealTimers();
  });

  it('should create a session', async () => {
    const session = await manager.create('tenant-1');
    expect(session.id).toBeTruthy();
    expect(session.appId).toBe('tenant-1');
    expect(session.conversationHistory).toEqual([]);
    expect(manager.size).toBe(1);
  });

  it('should get an existing session', async () => {
    const session = await manager.create('tenant-1');
    const found = manager.get(session.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(session.id);
  });

  it('should return undefined for unknown session', () => {
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('should destroy a session', async () => {
    const session = await manager.create('tenant-1');
    manager.destroy(session.id);
    expect(manager.get(session.id)).toBeUndefined();
    expect(manager.size).toBe(0);
  });

  it('should clean up expired sessions', async () => {
    await manager.create('tenant-1');
    expect(manager.size).toBe(1);

    vi.advanceTimersByTime(1500);
    const removed = manager.cleanup();

    expect(removed).toBe(1);
    expect(manager.size).toBe(0);
  });

  it('should not clean up active sessions', async () => {
    const session = await manager.create('tenant-1');
    vi.advanceTimersByTime(500);

    // Access the session to update lastAccessedAt
    manager.get(session.id);
    vi.advanceTimersByTime(600);

    const removed = manager.cleanup();
    expect(removed).toBe(0);
    expect(manager.size).toBe(1);
  });

  it('should update repo for new sessions', async () => {
    const newRepo = makeRepo();
    newRepo.config.name = 'updated';
    manager.updateRepo(newRepo);

    // The next created session should use the new repo
    const session = await manager.create('tenant-1');
    expect(session).toBeDefined();
  });

  it('should shutdown cleanly', async () => {
    await manager.create('tenant-1');
    await manager.create('tenant-2');
    expect(manager.size).toBe(2);

    await manager.shutdown();
    expect(manager.size).toBe(0);
  });

  it('should update lastAccessedAt on get', async () => {
    const session = await manager.create('tenant-1');
    const initialAccess = session.lastAccessedAt;

    vi.advanceTimersByTime(100);
    manager.get(session.id);

    expect(session.lastAccessedAt).toBeGreaterThan(initialAccess);
  });
});
