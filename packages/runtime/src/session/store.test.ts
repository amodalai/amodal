/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for PGLiteSessionStore.
 *
 * Uses a real in-memory PGLite instance — no mocks.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {PGLiteSessionStore} from './store.js';
import type {PersistedSession} from './types.js';
import {createLogger} from '../logger.js';

const logger = createLogger({component: 'test:session-store'});

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    version: 1,
    id: `sess-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: 'tenant-1',
    userId: 'user-1',
    messages: [{role: 'user', content: 'Hello'}],
    tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PGLiteSessionStore', () => {
  let store: PGLiteSessionStore;

  beforeAll(async () => {
    store = new PGLiteSessionStore({logger});
    await store.initialize();
  });

  afterAll(async () => {
    await store.close();
  });

  it('save and load a session', async () => {
    const session = makeSession();
    await store.save(session);

    const loaded = await store.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.tenantId).toBe(session.tenantId);
    expect(loaded!.userId).toBe(session.userId);
    expect(loaded!.version).toBe(1);
    expect(loaded!.messages).toEqual(session.messages);
    expect(loaded!.tokenUsage).toEqual(session.tokenUsage);
  });

  it('load returns null for missing session', async () => {
    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('save updates existing session (upsert)', async () => {
    const session = makeSession();
    await store.save(session);

    // Update messages and re-save
    session.messages = [
      {role: 'user', content: 'Hello'},
      {role: 'assistant', content: 'Hi there'},
    ];
    session.tokenUsage = {inputTokens: 200, outputTokens: 100, totalTokens: 300};
    session.updatedAt = new Date();
    await store.save(session);

    const loaded = await store.load(session.id);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.tokenUsage.totalTokens).toBe(300);
  });

  it('list sessions filtered by tenant, newest first', async () => {
    const tenantId = `tenant-list-${Date.now()}`;

    const older = makeSession({
      tenantId,
      updatedAt: new Date('2026-01-01'),
    });
    const newer = makeSession({
      tenantId,
      updatedAt: new Date('2026-03-01'),
    });

    await store.save(older);
    await store.save(newer);

    const sessions = await store.list(tenantId);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // Newest first
    const ids = sessions.map((s) => s.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });

  it('list does not return sessions from other tenants', async () => {
    const tenantA = `tenant-a-${Date.now()}`;
    const tenantB = `tenant-b-${Date.now()}`;

    await store.save(makeSession({tenantId: tenantA}));
    await store.save(makeSession({tenantId: tenantB}));

    const sessionsA = await store.list(tenantA);
    expect(sessionsA.every((s) => s.tenantId === tenantA)).toBe(true);
  });

  it('delete removes a session', async () => {
    const session = makeSession();
    await store.save(session);

    const deleted = await store.delete(session.id);
    expect(deleted).toBe(true);

    const loaded = await store.load(session.id);
    expect(loaded).toBeNull();
  });

  it('delete returns false for missing session', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('cleanup removes sessions older than cutoff', async () => {
    const tenantId = `tenant-cleanup-${Date.now()}`;
    const old = makeSession({
      tenantId,
      updatedAt: new Date('2020-01-01'),
    });
    const recent = makeSession({
      tenantId,
      updatedAt: new Date(),
    });

    await store.save(old);
    await store.save(recent);

    const cleaned = await store.cleanup(new Date('2025-01-01'));
    expect(cleaned).toBeGreaterThanOrEqual(1);

    // Old session gone
    const loaded = await store.load(old.id);
    expect(loaded).toBeNull();

    // Recent session still there
    const loadedRecent = await store.load(recent.id);
    expect(loadedRecent).not.toBeNull();
  });

  it('metadata is preserved through save/load', async () => {
    const session = makeSession({
      metadata: {
        title: 'Test Session',
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        appId: 'my-app',
      },
    });
    await store.save(session);

    const loaded = await store.load(session.id);
    expect(loaded!.metadata.title).toBe('Test Session');
    expect(loaded!.metadata.model).toBe('claude-sonnet-4-20250514');
    expect(loaded!.metadata.provider).toBe('anthropic');
    expect(loaded!.metadata.appId).toBe('my-app');
  });
});
