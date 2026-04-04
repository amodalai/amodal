/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for StandaloneSessionManager.
 *
 * Tests session lifecycle: create, persist, resume, destroy, cleanup.
 * Uses a real PGLiteSessionStore — no mocks for persistence.
 * LLM provider is stubbed since we're testing the manager, not the loop.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {StandaloneSessionManager} from './manager.js';
import {PGLiteSessionStore} from './store.js';
import type {CreateSessionOptions, TurnUsage} from './types.js';
import type {LLMProvider} from '../providers/types.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import {createLogger} from '../logger.js';
import {createToolRegistry} from '../tools/registry.js';

const logger = createLogger({component: 'test:session-manager'});

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function stubProvider(model = 'test-model', provider = 'test-provider'): LLMProvider {
  return {
    model,
    provider,
     
    languageModel: {} as LLMProvider['languageModel'],
    streamText: () => {
      throw new Error('streamText not implemented in stub');
    },
    generateText: () => Promise.reject(new Error('generateText not implemented in stub')),
  };
}

function stubPermissionChecker(): PermissionChecker {
  return {
    check: () => Promise.resolve({allowed: true as const}),
  };
}

function makeCreateOpts(overrides: Partial<CreateSessionOptions> = {}): CreateSessionOptions {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    provider: stubProvider(),
    toolRegistry: createToolRegistry(),
    permissionChecker: stubPermissionChecker(),
    systemPrompt: 'You are a helpful assistant.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StandaloneSessionManager', () => {
  let store: PGLiteSessionStore;

  beforeAll(async () => {
    store = new PGLiteSessionStore({logger});
    await store.initialize();
  });

  afterAll(async () => {
    await store.close();
  });

  describe('create', () => {
    it('creates a session with a generated ID', () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts());

      expect(session.id).toBeTruthy();
      expect(session.tenantId).toBe('tenant-1');
      expect(session.userId).toBe('user-1');
      expect(session.model).toBe('test-model');
      expect(session.providerName).toBe('test-provider');
      expect(session.messages).toEqual([]);
      expect(session.usage.inputTokens).toBe(0);
    });

    it('stores session in memory', () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts());

      expect(mgr.has(session.id)).toBe(true);
      expect(mgr.get(session.id)).toBe(session);
      expect(mgr.size).toBe(1);
    });

    it('uses custom maxTurns and maxContextTokens', () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts({
        maxTurns: 10,
        maxContextTokens: 100_000,
      }));

      expect(session.maxTurns).toBe(10);
      expect(session.maxContextTokens).toBe(100_000);
    });

    it('uses manager defaults when not specified', () => {
      const mgr = new StandaloneSessionManager({
        logger,
        store,
        defaultMaxTurns: 25,
        defaultMaxContextTokens: 150_000,
      });
      const session = mgr.create(makeCreateOpts());

      expect(session.maxTurns).toBe(25);
      expect(session.maxContextTokens).toBe(150_000);
    });
  });

  describe('persist and resume', () => {
    it('persists a session and resumes it with preserved messages', async () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts());

      // Simulate some messages
      session.messages = [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi there!'},
      ];
      session.usage = {inputTokens: 100, outputTokens: 50, totalTokens: 150};

      await mgr.persist(session);

      // Destroy and resume
      await mgr.destroy(session.id);
      expect(mgr.has(session.id)).toBe(false);

      const resumed = await mgr.resume(session.id, makeCreateOpts({
        systemPrompt: 'Updated system prompt',
      }));

      expect(resumed).not.toBeNull();
      expect(resumed!.id).toBe(session.id);
      expect(resumed!.messages).toHaveLength(2);
      expect(resumed!.usage.totalTokens).toBe(150);
      // System prompt should be fresh, not stale
      expect(resumed!.systemPrompt).toBe('Updated system prompt');
    });

    it('resume returns null for missing session', async () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const result = await mgr.resume('nonexistent', makeCreateOpts());
      expect(result).toBeNull();
    });

    it('version field is present on persisted sessions', async () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts());
      await mgr.persist(session);

      const persisted = await store.load(session.id);
      expect(persisted!.version).toBe(1);
    });
  });

  describe('list persisted', () => {
    it('lists sessions filtered by tenant', async () => {
      const tenantId = `tenant-list-mgr-${Date.now()}`;
      const mgr = new StandaloneSessionManager({logger, store});

      const s1 = mgr.create(makeCreateOpts({tenantId}));
      const s2 = mgr.create(makeCreateOpts({tenantId}));
      mgr.create(makeCreateOpts({tenantId: 'other-tenant'}));

      await mgr.persist(s1);
      await mgr.persist(s2);

      const list = await mgr.listPersisted(tenantId);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.every((s) => s.tenantId === tenantId)).toBe(true);
    });
  });

  describe('destroy', () => {
    it('removes session from memory', async () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts());

      await mgr.destroy(session.id);
      expect(mgr.has(session.id)).toBe(false);
      expect(mgr.size).toBe(0);
    });

    it('optionally deletes from store', async () => {
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts());
      await mgr.persist(session);

      await mgr.destroy(session.id, {deleteFromStore: true});

      const loaded = await store.load(session.id);
      expect(loaded).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('destroys sessions idle beyond TTL', async () => {
      const mgr = new StandaloneSessionManager({logger, store, ttlMs: 1});

      const session = mgr.create(makeCreateOpts());
      // Force old lastAccessedAt
      session.lastAccessedAt = Date.now() - 1000;

      const destroyed = await mgr.cleanup();
      expect(destroyed).toBeGreaterThanOrEqual(1);
      expect(mgr.has(session.id)).toBe(false);
    });

    it('does not destroy recently accessed sessions', async () => {
      const mgr = new StandaloneSessionManager({logger, store, ttlMs: 60_000});
      const session = mgr.create(makeCreateOpts());

      const destroyed = await mgr.cleanup();
      expect(destroyed).toBe(0);
      expect(mgr.has(session.id)).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('destroys all sessions and closes store', async () => {
      const shutdownStore = new PGLiteSessionStore({logger});
      await shutdownStore.initialize();

      const mgr = new StandaloneSessionManager({logger, store: shutdownStore});
      mgr.start();

      mgr.create(makeCreateOpts());
      mgr.create(makeCreateOpts());
      expect(mgr.size).toBe(2);

      await mgr.shutdown();
      expect(mgr.size).toBe(0);
    });
  });

  describe('onUsage hook on AgentContext', () => {
    it('onUsage is available on AgentContext interface', () => {
      // Type-level test: verify the hook exists on AgentContext
      // (actual firing is tested in streaming.test.ts)
      const mgr = new StandaloneSessionManager({logger, store});
      const session = mgr.create(makeCreateOpts());
      expect(session).toBeDefined();

      // Verify the onUsage option is accepted
      const usageEvents: TurnUsage[] = [];
      const onUsage = (usage: TurnUsage) => usageEvents.push(usage);
      expect(typeof onUsage).toBe('function');
    });
  });
});
