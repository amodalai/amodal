/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import type {ModelMessage} from 'ai';
import type {RuntimeEventBus} from '../events/event-bus.js';
import type {SessionStore} from '../session/store.js';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {PersistedSession} from '../session/types.js';
import {createSessionsHistoryRouter} from './sessions-history.js';

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const now = new Date('2026-05-05T12:00:00.000Z');
  return {
    version: 1,
    id: 'sess-1',
    scopeId: 'scope-1',
    messages: [],
    tokenUsage: {
      inputTokens: 12,
      outputTokens: 8,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 20,
    },
    metadata: {appId: 'app-1', title: 'Replay fixture', model: 'gpt-5.4'},
    imageData: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createApp(session: PersistedSession | null, appId = 'app-1') {
  const sessionStore = {
    initialize: vi.fn(),
    save: vi.fn(),
    load: vi.fn().mockResolvedValue(session),
    list: vi.fn(),
    delete: vi.fn(),
    cleanup: vi.fn(),
    close: vi.fn(),
  } as unknown as SessionStore;
  const sessionManager = {
    get: vi.fn(),
    persist: vi.fn(),
    destroy: vi.fn(),
  } as unknown as StandaloneSessionManager;
  const eventBus = {
    emit: vi.fn(),
  } as unknown as RuntimeEventBus;

  const app = express();
  app.use(express.json());
  app.use(createSessionsHistoryRouter({sessionStore, sessionManager, eventBus, appId}));
  return app;
}

describe('GET /sessions/history/:id', () => {
  it('returns 404 when the persisted session belongs to another app', async () => {
    const app = createApp(makeSession({metadata: {appId: 'app-2'}}), 'app-1');

    const res = await request(app).get('/sessions/history/sess-1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({error: 'Session not found'});
  });

  it('returns backend-computed cost snapshot when pricing is known', async () => {
    const app = createApp(makeSession({
      tokenUsage: {
        inputTokens: 118_913,
        outputTokens: 111,
        cachedInputTokens: 118_424,
        cacheCreationInputTokens: 181,
        totalTokens: 119_024,
      },
      metadata: {
        appId: 'app-1',
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
      },
    }));

    const res = await request(app).get('/sessions/history/sess-1');

    expect(res.status).toBe(200);
    expect(res.body.cost).toMatchObject({
      currency: 'USD',
      estimatedCostMicros: 38_795,
      inputTokens: 118_913,
      outputTokens: 111,
      totalTokens: 119_024,
      billableInputTokens: 308,
      cacheReadInputTokens: 118_424,
      cacheCreationInputTokens: 181,
      pricing: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        inputPerMToken: 3_000_000,
        outputPerMToken: 15_000_000,
        cacheReadPerMToken: 300_000,
        cacheWritePerMToken: 3_750_000,
        source: 'amodal-core-model-pricing',
      },
    });
  });

  it('attaches persisted tool results to replayed assistant tool calls', async () => {
    const messages = [
      {role: 'user', content: 'Look up the latest deployment.'},
      {
        role: 'assistant',
        content: [
          {type: 'text', text: 'I checked the deployment.'},
          {type: 'tool-call', toolCallId: 'tool-1', toolName: 'deployment_status', input: {env: 'prod'}},
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: 'tool-1',
            toolName: 'deployment_status',
            output: {state: 'ready', url: 'https://example.test'},
          },
        ],
      },
    ] as ModelMessage[];
    const app = createApp(makeSession({messages}));

    const res = await request(app).get('/sessions/history/sess-1');

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      {
        role: 'user',
        type: 'user',
        id: 'hist-0',
        text: 'Look up the latest deployment.',
        timestamp: '2026-05-05T12:00:00.000Z',
      },
      {
        role: 'assistant',
        type: 'assistant_text',
        id: 'hist-1',
        text: 'I checked the deployment.',
        timestamp: '2026-05-05T12:00:00.000Z',
        toolCalls: [
          {
            toolId: 'tool-1',
            toolName: 'deployment_status',
            parameters: {env: 'prod'},
            result: {state: 'ready', url: 'https://example.test'},
          },
        ],
      },
    ]);
  });
});
