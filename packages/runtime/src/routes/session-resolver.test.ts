/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {resolveBundle, resolveSession} from './session-resolver.js';
import type {SharedResources} from './session-resolver.js';
import type {AgentBundle} from '@amodalai/types';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {Session} from '../session/types.js';
import {SessionError} from '../errors.js';

// ---------------------------------------------------------------------------
// Mock buildSessionComponents — we test the resolver, not the builder
// ---------------------------------------------------------------------------

const mockBuildSessionComponents = vi.fn();
vi.mock('../session/session-builder.js', () => ({
  buildSessionComponents: (...args: unknown[]) => mockBuildSessionComponents(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stubBundle(name = 'test-agent'): AgentBundle {
  return {
    config: {name, models: {main: {provider: 'test', model: 'test-model'}}} as AgentBundle['config'],
    connections: new Map(),
    resolvedCredentials: {},
    stores: [],
    skills: [],
    knowledge: [],
    tools: [],
    agents: {main: undefined},
  } as unknown as AgentBundle;
}

function stubComponents() {
  const factory = vi.fn();
  return {
    provider: {model: 'test-model', provider: 'test'},
    toolRegistry: {size: 0},
    permissionChecker: {check: () => ({allowed: true as const})},
    systemPrompt: 'test prompt',
    toolContextFactory: factory,
  };
}

function stubSession(id: string, hasFactory = true): Session {
  return {
    id,
    model: 'test-model',
    providerName: 'test',
    toolContextFactory: hasFactory ? vi.fn() : undefined,
  } as unknown as Session;
}

function stubSessionManager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    get: vi.fn(),
    resume: vi.fn(),
    create: vi.fn(),
    ...overrides,
  } as unknown as StandaloneSessionManager;
}

function stubShared(): SharedResources {
  return {
    storeBackend: null,
    mcpManager: null,
    logger: {info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn()} as unknown as SharedResources['logger'],
  };
}

// ---------------------------------------------------------------------------
// resolveBundle
// ---------------------------------------------------------------------------

describe('resolveBundle', () => {
  it('returns static bundle when no deployId', async () => {
    const bundle = stubBundle();
    const result = await resolveBundle({staticBundle: bundle});
    expect(result).toBe(bundle);
  });

  it('returns null when no bundle available', async () => {
    const result = await resolveBundle({});
    expect(result).toBeNull();
  });

  it('calls bundleProvider when deployId is provided', async () => {
    const bundle = stubBundle();
    const provider = vi.fn().mockResolvedValue(bundle);
    const result = await resolveBundle({bundleProvider: provider}, 'deploy-1', 'token-abc');
    expect(provider).toHaveBeenCalledWith('deploy-1', 'token-abc');
    expect(result).toBe(bundle);
  });

  it('falls back to static bundle when no deployId even if bundleProvider exists', async () => {
    const staticBundle = stubBundle('static');
    const provider = vi.fn();
    const result = await resolveBundle({staticBundle, bundleProvider: provider});
    expect(provider).not.toHaveBeenCalled();
    expect(result).toBe(staticBundle);
  });
});

// ---------------------------------------------------------------------------
// resolveSession
// ---------------------------------------------------------------------------

describe('resolveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSessionComponents.mockReturnValue(stubComponents());
  });

  it('returns in-memory session with cached factory (no rebuild)', async () => {
    const session = stubSession('sess-1');
    const mgr = stubSessionManager({get: vi.fn().mockReturnValue(session)});

    const result = await resolveSession('sess-1', {
      sessionManager: mgr,
      bundleResolver: {staticBundle: stubBundle()},
      shared: stubShared(),
    });

    expect(result.session).toBe(session);
    expect(result.toolContextFactory).toBe(session.toolContextFactory);
    expect(mockBuildSessionComponents).not.toHaveBeenCalled();
  });

  it('resumes from store when not in memory', async () => {
    const resumed = stubSession('sess-2');
    const mgr = stubSessionManager({
      get: vi.fn().mockReturnValue(undefined),
      resume: vi.fn().mockResolvedValue(resumed),
    });

    const result = await resolveSession('sess-2', {
      sessionManager: mgr,
      bundleResolver: {staticBundle: stubBundle()},
      shared: stubShared(),
    });

    expect(result.session).toBe(resumed);
    expect(mockBuildSessionComponents).toHaveBeenCalledOnce();
    expect((mgr.resume as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'sess-2',
      expect.any(Object),
    );
  });

  it('creates new session when session_id not found', async () => {
    const created = stubSession('sess-3');
    const mgr = stubSessionManager({
      get: vi.fn().mockReturnValue(undefined),
      resume: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockReturnValue(created),
    });

    const result = await resolveSession('sess-not-found', {
      sessionManager: mgr,
      bundleResolver: {staticBundle: stubBundle()},
      shared: stubShared(),
    });

    expect(result.session).toBe(created);
    expect((mgr.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('creates new session when no session_id provided', async () => {
    const created = stubSession('sess-new');
    const mgr = stubSessionManager({
      create: vi.fn().mockReturnValue(created),
    });

    const result = await resolveSession(undefined, {
      sessionManager: mgr,
      bundleResolver: {staticBundle: stubBundle()},
      shared: stubShared(),
    });

    expect(result.session).toBe(created);
    expect((mgr.get as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('throws SessionError when no bundle available', async () => {
    const mgr = stubSessionManager();

    await expect(
      resolveSession(undefined, {
        sessionManager: mgr,
        bundleResolver: {},
        shared: stubShared(),
      }),
    ).rejects.toThrow(SessionError);
  });

  it('passes auth context through to the session manager', async () => {
    // Session identity (tenant / user mapping) is no longer threaded
    // through the session manager — callers that need it live at the
    // API boundary. This test is reduced to verify create() is called.
    const created = stubSession('sess-auth');
    const mgr = stubSessionManager({
      create: vi.fn().mockReturnValue(created),
    });

    await resolveSession(undefined, {
      sessionManager: mgr,
      bundleResolver: {staticBundle: stubBundle()},
      shared: stubShared(),
      auth: {applicationId: 'app-1', authMethod: 'api_key'},
    });

    expect(mgr.create).toHaveBeenCalled();
  });

  it('stores toolContextFactory on created session via CreateSessionOptions', async () => {
    const created = stubSession('sess-factory');
    const mockCreate = vi.fn().mockReturnValue(created);
    const mgr = stubSessionManager({create: mockCreate});

    await resolveSession(undefined, {
      sessionManager: mgr,
      bundleResolver: {staticBundle: stubBundle()},
      shared: stubShared(),
    });

    const createArg = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg['toolContextFactory']).toBeDefined();
    expect(typeof createArg['toolContextFactory']).toBe('function');
  });
});
