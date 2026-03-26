/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Define mock functions at module scope — persists across clearAllMocks
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockShutdownAudit = vi.fn().mockResolvedValue(undefined);
const mockGetGeminiClient = vi.fn().mockReturnValue({});
const mockGetMessageBus = vi.fn().mockReturnValue({
  on: vi.fn(),
  removeListener: vi.fn(),
});

// Use a function constructor so each `new Config()` returns a fresh mock object
// with the same module-scope mock functions.
const mockGetConnections = vi.fn().mockReturnValue({});
const mockGetUpstreamConfig = vi.fn().mockReturnValue({});
const MockConfig = vi.fn(function (this: Record<string, unknown>) {
  this['initialize'] = mockInitialize;
  this['shutdownAudit'] = mockShutdownAudit;
  this['getGeminiClient'] = mockGetGeminiClient;
  this['getMessageBus'] = mockGetMessageBus;
  this['getConnections'] = mockGetConnections;
  this['getUpstreamConfig'] = mockGetUpstreamConfig;
  this['initializeAuth'] = vi.fn().mockResolvedValue(undefined);
  this['getModelConfig'] = vi.fn().mockReturnValue(undefined);
  this['setModelConfig'] = vi.fn();
  this['getBasePrompt'] = vi.fn().mockReturnValue(undefined);
  this['getAgentName'] = vi.fn().mockReturnValue('Test Agent');
  this['getAgentDescription'] = vi.fn().mockReturnValue(undefined);
  this['getAgentContext'] = vi.fn().mockReturnValue(undefined);
  this['getModel'] = vi.fn().mockReturnValue('test-model');
  this['getStores'] = vi.fn().mockReturnValue([]);
  this['getStoreBackend'] = vi.fn().mockReturnValue(undefined);
  this['setStoreBackend'] = vi.fn();
});

// AgentSDK mock
const mockSdkInitialize = vi.fn().mockResolvedValue(undefined);
const mockSdkGetConfig = vi.fn();
const MockAgentSDK = vi.fn(function (this: Record<string, unknown>) {
  this['initialize'] = mockSdkInitialize;
  this['getConfig'] = mockSdkGetConfig;
});

vi.mock('@amodalai/core', () => ({
  AmodalConfig: MockConfig,
  AgentSDK: MockAgentSDK,
  Scheduler: vi.fn(function (this: Record<string, unknown>) {
    this['schedule'] = vi.fn();
  }),
  ROOT_SCHEDULER_ID: 'root',
  ApprovalMode: { YOLO: 'yolo' },
  PolicyDecision: { ALLOW: 'allow', ASK_USER: 'ask_user', DENY: 'deny' },
  buildDefaultPrompt: vi.fn().mockReturnValue('Default system prompt'),
}));

const { SessionManager } = await import('./session-manager.js');

describe('SessionManager', () => {
  let manager: InstanceType<typeof SessionManager>;

  // Build a mock Config object for AgentSDK.getConfig() to return
  function makeMockConfig() {
    return {
      initialize: mockInitialize,
      shutdownAudit: mockShutdownAudit,
      getGeminiClient: mockGetGeminiClient,
      getMessageBus: mockGetMessageBus,
      getConnections: mockGetConnections,
      getUpstreamConfig: mockGetUpstreamConfig,
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      initializeAuth: vi.fn().mockResolvedValue(undefined),
      getModelConfig: vi.fn().mockReturnValue(undefined),
      setModelConfig: vi.fn(),
      getBasePrompt: vi.fn().mockReturnValue(undefined),
      getAgentName: vi.fn().mockReturnValue('Test Agent'),
      getAgentDescription: vi.fn().mockReturnValue(undefined),
      getAgentContext: vi.fn().mockReturnValue(undefined),
      getModel: vi.fn().mockReturnValue('test-model'),
      getStores: vi.fn().mockReturnValue([]),
      getStoreBackend: vi.fn().mockReturnValue(undefined),
      setStoreBackend: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-attach default implementations after clearAllMocks
    mockInitialize.mockResolvedValue(undefined);
    mockShutdownAudit.mockResolvedValue(undefined);
    mockGetGeminiClient.mockReturnValue({});
    mockGetMessageBus.mockReturnValue({
      on: vi.fn(),
      removeListener: vi.fn(),
    });
    mockGetConnections.mockReturnValue({});
    mockSdkInitialize.mockResolvedValue(undefined);
    mockSdkGetConfig.mockReturnValue(makeMockConfig());

    manager = new SessionManager({
      baseParams: {
        sessionId: 'base',
        model: 'test-model',
        cwd: '/tmp',
        targetDir: '/tmp',
        debugMode: false,
      },
      cleanupIntervalMs: 60_000,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  describe('create', () => {
    it('creates a session with unique ID', async () => {
      const session = await manager.create();
      expect(session.id).toBeDefined();
      expect(session.id.length).toBeGreaterThan(0);
      expect(session.config).toBeDefined();
      expect(session.geminiClient).toBeDefined();
      expect(session.scheduler).toBeDefined();
      expect(manager.size).toBe(1);
    });

    it('passes YOLO approval mode and non-interactive flags', async () => {
      await manager.create();
      const calls = MockConfig.mock.calls as unknown[][];
      const configCall = calls[0]?.[0] as Record<string, unknown>;
      expect(configCall['approvalMode']).toBe('yolo');
      expect(configCall['interactive']).toBe(false);
      expect(configCall['noBrowser']).toBe(true);
      const policyConfig = configCall['policyEngineConfig'] as Record<string, unknown>;
      expect(policyConfig['approvalMode']).toBe('yolo');
      expect(policyConfig['defaultDecision']).toBe('allow');
      const rules = policyConfig['rules'] as Array<Record<string, unknown>>;
      expect(rules).toHaveLength(1);
      expect(rules[0]?.['decision']).toBe('allow');
      expect(rules[0]?.['priority']).toBe(9999);
    });

    it('overrides role when provided', async () => {
      await manager.create('analyst');
      const calls = MockConfig.mock.calls as unknown[][];
      const configCall = calls[0]?.[0] as Record<string, unknown>;
      expect(configCall['activeRole']).toBe('analyst');
    });

    it('initializes the Config', async () => {
      await manager.create();
      expect(mockInitialize).toHaveBeenCalledOnce();
    });

    it('creates multiple sessions with different IDs', async () => {
      const s1 = await manager.create();
      const s2 = await manager.create();
      expect(s1.id).not.toBe(s2.id);
      expect(manager.size).toBe(2);
    });

    it('passes platform context via Config fallback when auth has no token', async () => {
      const authManager = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
        },
        cleanupIntervalMs: 60_000,
        platformApiUrl: 'http://localhost:4000',
      });

      const auth = {
        apiKey: 'ak_test-key',
        orgId: 'org-123',
        applicationId: 'app-456',
        tenantId: 'ten-789',
        authMethod: 'api_key' as const,
      };

      const session = await authManager.create(undefined, auth);
      expect(session.orgId).toBe('org-123');

      // No token → falls back to Config path, not AgentSDK
      expect(MockAgentSDK).not.toHaveBeenCalled();

      // Verify platform params were passed to Config
      const calls = MockConfig.mock.calls as unknown[][];
      const lastCall = calls[calls.length - 1]?.[0] as Record<string, unknown>;
      expect(lastCall['platformApiUrl']).toBe('http://localhost:4000');
      expect(lastCall['platformApiKey']).toBe('ak_test-key');
      expect(lastCall['applicationId']).toBe('app-456');
      expect(lastCall['tenantId']).toBe('ten-789');

      await authManager.shutdown();
    });

    it('uses AgentSDK when auth token is provided', async () => {
      const authManager = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
          agentContext: 'Test agent context',
        },
        cleanupIntervalMs: 60_000,
        platformApiUrl: 'http://localhost:4000',
      });

      const auth = {
        token: 'jwt.token.here',
        orgId: 'org-jwt',
        applicationId: 'app-jwt',
        tenantId: 'tenant-jwt',
        authMethod: 'platform_jwt' as const,
      };

      const session = await authManager.create(undefined, auth);
      expect(session.orgId).toBe('org-jwt');

      // Verify AgentSDK was used
      expect(MockAgentSDK).toHaveBeenCalledOnce();
      const sdkCalls = MockAgentSDK.mock.calls as unknown[][];
      const sdkConfig = sdkCalls[0]?.[0] as Record<string, unknown>;
      const platform = sdkConfig['platform'] as Record<string, unknown>;
      expect(platform['apiUrl']).toBe('http://localhost:4000');
      expect(platform['apiKey']).toBe('jwt.token.here');
      expect(sdkConfig['applicationId']).toBe('app-jwt');
      expect(sdkConfig['tenantId']).toBe('tenant-jwt');
      // base_prompt and agent_context fetched from application during SDK initialize

      // Verify Config was NOT called directly (AgentSDK creates it internally)
      expect(MockConfig).not.toHaveBeenCalled();
      expect(mockSdkInitialize).toHaveBeenCalledOnce();
      expect(mockSdkGetConfig).toHaveBeenCalledOnce();

      await authManager.shutdown();
    });

    it('passes role to AgentSDK when auth token is provided', async () => {
      const authManager = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
        },
        cleanupIntervalMs: 60_000,
        platformApiUrl: 'http://localhost:4000',
      });

      const auth = {
        token: 'ak_test-key',
        apiKey: 'ak_test-key',
        orgId: 'org-123',
        applicationId: 'app-456',
        tenantId: 'ten-789',
        authMethod: 'api_key' as const,
      };

      await authManager.create('analyst', auth);

      // Verify role was passed to AgentSDK config
      const sdkCalls = MockAgentSDK.mock.calls as unknown[][];
      const sdkConfig = sdkCalls[0]?.[0] as Record<string, unknown>;
      expect(sdkConfig['activeRole']).toBe('analyst');

      await authManager.shutdown();
    });

    it('handles JWT auth without token via Config fallback', async () => {
      const authManager = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
        },
        cleanupIntervalMs: 60_000,
        platformApiUrl: 'http://localhost:4000',
      });

      const auth = {
        orgId: 'org-jwt',
        applicationId: 'app-jwt',
        tenantId: 'tenant-jwt',
        authMethod: 'platform_jwt' as const,
      };

      const session = await authManager.create(undefined, auth);
      expect(session.orgId).toBe('org-jwt');

      // No token → Config path, not AgentSDK
      expect(MockAgentSDK).not.toHaveBeenCalled();

      // Verify platform params — no platformApiKey set
      const calls = MockConfig.mock.calls as unknown[][];
      const lastCall = calls[calls.length - 1]?.[0] as Record<string, unknown>;
      expect(lastCall['platformApiUrl']).toBe('http://localhost:4000');
      expect(lastCall['platformApiKey']).toBeUndefined();
      expect(lastCall['applicationId']).toBe('app-jwt');
      expect(lastCall['tenantId']).toBe('tenant-jwt');

      await authManager.shutdown();
    });

    it('passes session params as configOverrides to AgentSDK', async () => {
      const authManager = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
        },
        cleanupIntervalMs: 60_000,
        platformApiUrl: 'http://localhost:4000',
      });

      const auth = {
        token: 'jwt.token.here',
        orgId: 'org-1',
        applicationId: 'app-1',
        tenantId: 'ten-1',
        authMethod: 'platform_jwt' as const,
      };

      await authManager.create(undefined, auth);

      // Verify configOverrides (second arg to AgentSDK constructor)
      const sdkCalls = MockAgentSDK.mock.calls as unknown[][];
      const overrides = sdkCalls[0]?.[1] as Record<string, unknown>;
      expect(overrides['approvalMode']).toBe('yolo');
      expect(overrides['interactive']).toBe(false);
      expect(overrides['noBrowser']).toBe(true);
      expect(overrides['model']).toBe('test-model');

      await authManager.shutdown();
    });
  });

  describe('get', () => {
    it('returns existing session', async () => {
      const created = await manager.create();
      const retrieved = manager.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('returns undefined for unknown ID', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('updates lastAccessedAt on get', async () => {
      const session = await manager.create();
      const originalAccess = session.lastAccessedAt;

      await new Promise((r) => setTimeout(r, 10));

      manager.get(session.id);
      expect(session.lastAccessedAt).toBeGreaterThanOrEqual(originalAccess);
    });
  });

  describe('destroy', () => {
    it('removes session and calls shutdownAudit', async () => {
      const session = await manager.create();
      await manager.destroy(session.id);
      expect(manager.size).toBe(0);
      expect(mockShutdownAudit).toHaveBeenCalledOnce();
    });

    it('is a no-op for unknown ID', async () => {
      await manager.destroy('nonexistent');
      expect(mockShutdownAudit).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes expired sessions', async () => {
      const shortTtlManager = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
        },
        ttlMs: 1,
        cleanupIntervalMs: 60_000,
      });

      await shortTtlManager.create();
      await shortTtlManager.create();
      expect(shortTtlManager.size).toBe(2);

      await new Promise((r) => setTimeout(r, 10));

      const removed = await shortTtlManager.cleanup();
      expect(removed).toBe(2);
      expect(shortTtlManager.size).toBe(0);

      await shortTtlManager.shutdown();
    });

    it('keeps non-expired sessions', async () => {
      await manager.create();
      const removed = await manager.cleanup();
      expect(removed).toBe(0);
      expect(manager.size).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('destroys all sessions', async () => {
      await manager.create();
      await manager.create();
      await manager.shutdown();
      expect(manager.size).toBe(0);
    });
  });

  describe('hydrate', () => {
    const platformAuth = {
      token: 'ak_test-key',
      apiKey: 'ak_test-key',
      orgId: 'org-1',
      applicationId: 'app-1',
      tenantId: 'ten-1',
      authMethod: 'api_key' as const,
    };

    const storedMessages = [
      { type: 'user', id: 'msg-1', text: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { type: 'assistant_text', id: 'msg-2', text: 'Hi there!', timestamp: '2024-01-01T00:00:01Z' },
    ];

    function makeHydrateManager() {
      const mockSetHistory = vi.fn();
      mockGetGeminiClient.mockReturnValue({ setHistory: mockSetHistory });

      const mgr = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
        },
        cleanupIntervalMs: 60_000,
        platformApiUrl: 'http://localhost:4000',
      });

      return { mgr, mockSetHistory };
    }

    it('returns null when platformApiUrl is missing', async () => {
      // manager has no platformApiUrl
      const result = await manager.hydrate('conv-1', undefined, platformAuth);
      expect(result).toBeNull();
    });

    it('returns null when auth is missing', async () => {
      const { mgr } = makeHydrateManager();
      const result = await mgr.hydrate('conv-1');
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('returns null when auth has no token', async () => {
      const { mgr } = makeHydrateManager();
      const result = await mgr.hydrate('conv-1', undefined, {
        orgId: 'org-1',
        applicationId: 'app-1',
        tenantId: 'ten-1',
        authMethod: 'api_key',
      });
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('returns null when auth has no tenantId', async () => {
      const { mgr } = makeHydrateManager();
      const result = await mgr.hydrate('conv-1', undefined, {
        token: 'ak_test',
        orgId: 'org-1',
        applicationId: 'app-1',
        tenantId: '',
        authMethod: 'api_key',
      });
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('returns null on fetch failure', async () => {
      const { mgr } = makeHydrateManager();
      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await mgr.hydrate('conv-1', undefined, platformAuth);
      expect(result).toBeNull();
      fetchSpy.mockRestore();
      await mgr.shutdown();
    });

    it('returns null on non-OK HTTP response', async () => {
      const { mgr } = makeHydrateManager();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result = await mgr.hydrate('conv-1', undefined, platformAuth);
      expect(result).toBeNull();
      fetchSpy.mockRestore();
      await mgr.shutdown();
    });

    it('returns null when stored conversation has no messages', async () => {
      const { mgr } = makeHydrateManager();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'conv-1', tenant_id: 'ten-1', messages: [], status: 'active' }),
      } as Response);

      const result = await mgr.hydrate('conv-1', undefined, platformAuth);
      expect(result).toBeNull();
      fetchSpy.mockRestore();
      await mgr.shutdown();
    });

    it('creates session under original conversation ID', async () => {
      const { mgr, mockSetHistory } = makeHydrateManager();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'conv-original',
          tenant_id: 'ten-1',
          messages: storedMessages,
          status: 'active',
        }),
      } as Response);

      const session = await mgr.hydrate('conv-original', undefined, platformAuth);
      expect(session).not.toBeNull();
      expect(session!.id).toBe('conv-original');
      expect(mgr.get('conv-original')).toBeDefined();
      expect(mockSetHistory).toHaveBeenCalledOnce();

      fetchSpy.mockRestore();
      await mgr.shutdown();
    });

    it('seeds LLM history via setHistory', async () => {
      const { mgr, mockSetHistory } = makeHydrateManager();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'conv-history',
          tenant_id: 'ten-1',
          messages: storedMessages,
          status: 'active',
        }),
      } as Response);

      await mgr.hydrate('conv-history', undefined, platformAuth);

      expect(mockSetHistory).toHaveBeenCalledOnce();
      const historyArg = mockSetHistory.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(historyArg).toHaveLength(2);
      expect(historyArg[0]?.['role']).toBe('user');
      expect(historyArg[1]?.['role']).toBe('model');

      fetchSpy.mockRestore();
      await mgr.shutdown();
    });

    it('pre-populates accumulatedMessages', async () => {
      const { mgr } = makeHydrateManager();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'conv-acc',
          tenant_id: 'ten-1',
          messages: storedMessages,
          status: 'active',
        }),
      } as Response);

      const session = await mgr.hydrate('conv-acc', undefined, platformAuth);
      expect(session!.accumulatedMessages).toHaveLength(2);
      expect(session!.accumulatedMessages[0]?.text).toBe('Hello');
      expect(session!.accumulatedMessages[1]?.text).toBe('Hi there!');

      fetchSpy.mockRestore();
      await mgr.shutdown();
    });

    it('deduplicates concurrent hydration requests', async () => {
      const { mgr } = makeHydrateManager();

      let resolveJson!: (v: unknown) => void;
      const jsonPromise = new Promise((r) => { resolveJson = r; });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => jsonPromise,
      } as unknown as Response);

      // Start two concurrent hydrations for the same conversation
      const p1 = mgr.hydrate('conv-dedup', undefined, platformAuth);
      const p2 = mgr.hydrate('conv-dedup', undefined, platformAuth);

      // Resolve the fetch
      resolveJson({
        id: 'conv-dedup',
        tenant_id: 'ten-1',
        messages: storedMessages,
        status: 'active',
      });

      const [s1, s2] = await Promise.all([p1, p2]);

      // Both should return the same session
      expect(s1).toBe(s2);
      // Only one fetch was made
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
      await mgr.shutdown();
    });
  });

  describe('waitForAskUserResponse', () => {
    function makeFakeSession() {
      return {
        id: 'fake-sess',
        pendingAskUser: new Map(),
      } as unknown as import('./session-manager.js').ManagedSession;
    }

    it('resolves when resolveAskUser is called', async () => {
      const session = makeFakeSession();
      const controller = new AbortController();

      const promise = manager.waitForAskUserResponse(session, 'ask-1', controller.signal);

      // Resolve it
      const resolved = manager.resolveAskUser(session, 'ask-1', { '0': 'yes' });
      expect(resolved).toBe(true);

      const answers = await promise;
      expect(answers).toEqual({ '0': 'yes' });

      // Should be cleaned up
      expect(session.pendingAskUser.size).toBe(0);
    });

    it('returns false for non-existent ask_id', () => {
      const session = makeFakeSession();
      const resolved = manager.resolveAskUser(session, 'no-such-id', {});
      expect(resolved).toBe(false);
    });

    it('rejects when signal is aborted', async () => {
      const session = makeFakeSession();
      const controller = new AbortController();

      const promise = manager.waitForAskUserResponse(session, 'ask-abort', controller.signal);
      controller.abort();

      await expect(promise).rejects.toThrow('ask_user aborted');
      expect(session.pendingAskUser.size).toBe(0);
    });
  });
});
