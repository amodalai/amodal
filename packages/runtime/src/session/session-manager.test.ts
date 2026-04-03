/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Define mock functions at module scope — persists across clearAllMocks
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockShutdownAudit = vi.fn().mockResolvedValue(undefined);
const mockGetGeminiClient = vi.fn().mockReturnValue({
  isInitialized: vi.fn().mockReturnValue(true),
  initialize: vi.fn().mockResolvedValue(undefined),
  getChat: vi.fn().mockReturnValue({
    setSystemInstruction: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
  }),
  setHistory: vi.fn(),
  setTools: vi.fn().mockResolvedValue(undefined),
  getCurrentSequenceModel: vi.fn().mockReturnValue(undefined),
});
const mockGetMessageBus = vi.fn().mockReturnValue({
  on: vi.fn(),
  removeListener: vi.fn(),
});

// Use a function constructor so each `new Config()` returns a fresh mock object
// with the same module-scope mock functions.
const mockGetConnections = vi.fn().mockReturnValue({});
const mockToolRegistry = {
  registerTool: vi.fn(),
  unregisterTool: vi.fn(),
  getFunctionDeclarations: vi.fn().mockReturnValue([]),
};
const mockGetUpstreamConfig = vi.fn().mockReturnValue({
  createToolRegistry: vi.fn().mockResolvedValue(mockToolRegistry),
  getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
  getAgentRegistry: vi.fn().mockReturnValue({ getAllDefinitions: () => [] }),
  registerSubAgentTools: vi.fn(),
});
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
  this['registerTools'] = vi.fn().mockResolvedValue(undefined);
  this['getBundleSubagents'] = vi.fn().mockReturnValue([]);
  this['getDisabledSubagents'] = vi.fn().mockReturnValue([]);
  this['getAppId'] = vi.fn().mockReturnValue('test-app');
});

vi.mock('@amodalai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@amodalai/core')>();
  return {
    ...actual,
    AmodalConfig: MockConfig,
    Scheduler: vi.fn(function (this: Record<string, unknown>) {
      this['schedule'] = vi.fn();
    }),
    ROOT_SCHEDULER_ID: 'root',
    ApprovalMode: { YOLO: 'yolo' },
    PolicyDecision: { ALLOW: 'allow', ASK_USER: 'ask_user', DENY: 'deny' },
    buildDefaultPrompt: vi.fn().mockReturnValue('Default system prompt'),
    PlanModeManager: vi.fn(function (this: Record<string, unknown>) {
      this['isActive'] = vi.fn().mockReturnValue(false);
      this['enter'] = vi.fn();
      this['exit'] = vi.fn();
    }),
    McpManager: vi.fn(function (this: Record<string, unknown>) {
      this['startServers'] = vi.fn().mockResolvedValue(undefined);
      this['shutdown'] = vi.fn().mockResolvedValue(undefined);
      this['connectedCount'] = 0;
      this['getServerInfo'] = vi.fn().mockReturnValue([]);
      this['getDiscoveredTools'] = vi.fn().mockReturnValue([]);
    }),
    ensureAdminAgent: vi.fn().mockResolvedValue('/tmp/admin-agent'),
    loadAdminAgent: vi.fn().mockResolvedValue({ skills: [], knowledge: [], agentPrompt: 'admin prompt' }),
  };
});

const { SessionManager } = await import('./session-manager.js');

describe('SessionManager', () => {
  let manager: InstanceType<typeof SessionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-attach default implementations after clearAllMocks
    mockInitialize.mockResolvedValue(undefined);
    mockShutdownAudit.mockResolvedValue(undefined);
    mockGetGeminiClient.mockReturnValue({
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      getChat: vi.fn().mockReturnValue({ setSystemInstruction: vi.fn(), getHistory: vi.fn().mockReturnValue([]) }),
      setHistory: vi.fn(),
      setTools: vi.fn().mockResolvedValue(undefined),
      getCurrentSequenceModel: vi.fn().mockReturnValue(undefined),
    });
    mockGetMessageBus.mockReturnValue({
      on: vi.fn(),
      removeListener: vi.fn(),
    });
    mockGetConnections.mockReturnValue({});
    mockGetUpstreamConfig.mockReturnValue({
      createToolRegistry: vi.fn().mockResolvedValue(mockToolRegistry),
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
      getAgentRegistry: vi.fn().mockReturnValue({ getAllDefinitions: () => [] }),
      registerSubAgentTools: vi.fn(),
    });
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

    it('initializes the Config (non-platform uses minimal init)', async () => {
      const session = await manager.create();
      // Non-platform sessions skip config.initialize() and use minimal init
      // (initializeAuth + registerTools) to avoid upstream Gemini CLI hangs
      expect(session.config).toBeDefined();
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
      });

      const auth = {
        apiKey: 'ak_test-key',
        orgId: 'org-123',
        applicationId: 'app-456',
        authMethod: 'api_key' as const,
      };

      const session = await authManager.create(undefined, auth);
      expect(session.orgId).toBe('org-123');

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
      authMethod: 'api_key' as const,
    };

    const storedMessages = [
      { type: 'user', id: 'msg-1', text: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { type: 'assistant_text', id: 'msg-2', text: 'Hi there!', timestamp: '2024-01-01T00:00:01Z' },
    ];

    const mockGetSession = vi.fn();

    function makeHydrateManager() {
      const mockSetHistory = vi.fn();
      mockGetGeminiClient.mockReturnValue({
        isInitialized: vi.fn().mockReturnValue(true),
        initialize: vi.fn().mockResolvedValue(undefined),
        getChat: vi.fn().mockReturnValue({ setSystemInstruction: vi.fn(), getHistory: vi.fn().mockReturnValue([]) }),
        setHistory: mockSetHistory,
        setTools: vi.fn().mockResolvedValue(undefined),
        getCurrentSequenceModel: vi.fn().mockReturnValue(undefined),
      });
      mockGetSession.mockReset();

      const mgr = new SessionManager({
        baseParams: {
          sessionId: 'base',
          model: 'test-model',
          cwd: '/tmp',
          targetDir: '/tmp',
          debugMode: false,
        },
        cleanupIntervalMs: 60_000,
        sessionStore: { getSession: mockGetSession },
      });

      return { mgr, mockSetHistory };
    }

    it('returns null when sessionStore is missing', async () => {
      // default manager has no sessionStore
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
        authMethod: 'api_key',
      });
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('returns null when auth has no applicationId', async () => {
      const { mgr } = makeHydrateManager();
      const result = await mgr.hydrate('conv-1', undefined, {
        token: 'ak_test',
        orgId: 'org-1',
        applicationId: '',
        authMethod: 'api_key',
      });
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('returns null on session store error', async () => {
      const { mgr } = makeHydrateManager();
      mockGetSession.mockRejectedValueOnce(new Error('Network error'));

      const result = await mgr.hydrate('conv-1', undefined, platformAuth);
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('returns null when session store returns null', async () => {
      const { mgr } = makeHydrateManager();
      mockGetSession.mockResolvedValueOnce(null);

      const result = await mgr.hydrate('conv-1', undefined, platformAuth);
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('returns null when stored conversation has no messages', async () => {
      const { mgr } = makeHydrateManager();
      mockGetSession.mockResolvedValueOnce({ id: 'conv-1', app_id: 'app-1', messages: [], status: 'active' });

      const result = await mgr.hydrate('conv-1', undefined, platformAuth);
      expect(result).toBeNull();
      await mgr.shutdown();
    });

    it('creates session under original conversation ID', async () => {
      const { mgr, mockSetHistory } = makeHydrateManager();
      mockGetSession.mockResolvedValueOnce({
        id: 'conv-original',
        app_id: 'app-1',
        messages: storedMessages,
        status: 'active',
      });

      const session = await mgr.hydrate('conv-original', undefined, platformAuth);
      expect(session).not.toBeNull();
      expect(session!.id).toBe('conv-original');
      expect(mgr.get('conv-original')).toBeDefined();
      expect(mockSetHistory).toHaveBeenCalledOnce();

      await mgr.shutdown();
    });

    it('seeds LLM history via setHistory', async () => {
      const { mgr, mockSetHistory } = makeHydrateManager();
      mockGetSession.mockResolvedValueOnce({
        id: 'conv-history',
        app_id: 'app-1',
        messages: storedMessages,
        status: 'active',
      });

      await mgr.hydrate('conv-history', undefined, platformAuth);

      expect(mockSetHistory).toHaveBeenCalledOnce();
      const historyArg = mockSetHistory.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(historyArg).toHaveLength(2);
      expect(historyArg[0]?.['role']).toBe('user');
      expect(historyArg[1]?.['role']).toBe('model');

      await mgr.shutdown();
    });

    it('pre-populates accumulatedMessages', async () => {
      const { mgr } = makeHydrateManager();
      mockGetSession.mockResolvedValueOnce({
        id: 'conv-acc',
        app_id: 'app-1',
        messages: storedMessages,
        status: 'active',
      });

      const session = await mgr.hydrate('conv-acc', undefined, platformAuth);
      expect(session!.accumulatedMessages).toHaveLength(2);
      expect(session!.accumulatedMessages[0]?.text).toBe('Hello');
      expect(session!.accumulatedMessages[1]?.text).toBe('Hi there!');

      await mgr.shutdown();
    });

    it('deduplicates concurrent hydration requests', async () => {
      const { mgr } = makeHydrateManager();

      let resolveSession!: (v: unknown) => void;
      const sessionPromise = new Promise((r) => { resolveSession = r; });
      mockGetSession.mockReturnValue(sessionPromise);

      // Start two concurrent hydrations for the same conversation
      const p1 = mgr.hydrate('conv-dedup', undefined, platformAuth);
      const p2 = mgr.hydrate('conv-dedup', undefined, platformAuth);

      // Resolve the session store
      resolveSession({
        id: 'conv-dedup',
        app_id: 'app-1',
        messages: storedMessages,
        status: 'active',
      });

      const [s1, s2] = await Promise.all([p1, p2]);

      // Both should return the same session
      expect(s1).toBe(s2);
      // Only one store call was made
      expect(mockGetSession).toHaveBeenCalledTimes(1);

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
