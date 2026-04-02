/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import type {AgentBundle, StoreBackend, LoadedStore} from '@amodalai/core';
import {createStoresRouter} from './stores.js';

function makeStore(name: string): LoadedStore {
  return {
    name,
    entity: {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      key: '{id}',
      schema: {
        id: {type: 'string'},
        value: {type: 'string'},
      },
    },
    location: `/test/stores/${name}.json`,
  };
}

function makeRepo(stores: LoadedStore[]): AgentBundle {
  return {
    source: 'local',
    origin: '/test',
    config: {
      name: 'test',
      version: '1.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    },
    connections: new Map(),
    skills: [],
    agents: {subagents: []},
    automations: [],
    knowledge: [],
    evals: [],
    tools: [],
    stores,
  };
}

function makeMockBackend(): StoreBackend {
  return {
    initialize: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    history: vi.fn(),
    purgeExpired: vi.fn(),
    close: vi.fn(),
  };
}

function createApp(repo: AgentBundle, backend: StoreBackend) {
  const app = express();
  app.use(express.json());
  app.use(createStoresRouter({repo, storeBackend: backend, appId: 'test-tenant'}));
  return app;
}

describe('stores router', () => {
  describe('GET /api/stores', () => {
    it('returns store definitions with document counts', async () => {
      const stores = [makeStore('alerts'), makeStore('deals')];
      const repo = makeRepo(stores);
      const backend = makeMockBackend();
      vi.mocked(backend.list)
        .mockResolvedValueOnce({documents: [], total: 47, hasMore: false})
        .mockResolvedValueOnce({documents: [], total: 12, hasMore: false});

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores');

      expect(res.status).toBe(200);
      expect(res.body['stores']).toHaveLength(2);
      expect(res.body['stores'][0]['name']).toBe('alerts');
      expect(res.body['stores'][0]['documentCount']).toBe(47);
      expect(res.body['stores'][1]['documentCount']).toBe(12);
    });

    it('returns empty when no stores defined', async () => {
      const repo = makeRepo([]);
      const backend = makeMockBackend();

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores');

      expect(res.status).toBe(200);
      expect(res.body['stores']).toEqual([]);
    });
  });

  describe('GET /api/stores/:name', () => {
    it('lists documents from a store', async () => {
      const stores = [makeStore('alerts')];
      const repo = makeRepo(stores);
      const backend = makeMockBackend();
      vi.mocked(backend.list).mockResolvedValue({
        documents: [{key: 'a', appId: 'test', store: 'alerts', version: 1, payload: {id: 'a'}, meta: {computedAt: '2026-01-01', stale: false}}],
        total: 1,
        hasMore: false,
      });

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores/alerts');

      expect(res.status).toBe(200);
      expect(res.body['documents']).toHaveLength(1);
      expect(res.body['total']).toBe(1);
    });

    it('returns 404 for unknown store', async () => {
      const repo = makeRepo([]);
      const backend = makeMockBackend();

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores/nonexistent');

      expect(res.status).toBe(404);
    });

    it('parses filter query param', async () => {
      const stores = [makeStore('alerts')];
      const repo = makeRepo(stores);
      const backend = makeMockBackend();
      vi.mocked(backend.list).mockResolvedValue({documents: [], total: 0, hasMore: false});

      const app = createApp(repo, backend);
      await request(app)
        .get('/api/stores/alerts')
        .query({filter: '{"severity":"P1"}', sort: '-severity', limit: '10'});

      expect(backend.list).toHaveBeenCalledWith(
        'test-tenant',
        'alerts',
        expect.objectContaining({
          filter: {severity: 'P1'},
          sort: '-severity',
          limit: 10,
        }),
      );
    });

    it('returns 400 for invalid filter JSON', async () => {
      const stores = [makeStore('alerts')];
      const repo = makeRepo(stores);
      const backend = makeMockBackend();

      const app = createApp(repo, backend);
      const res = await request(app)
        .get('/api/stores/alerts')
        .query({filter: 'not json'});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/stores/:name/:key', () => {
    it('returns a document by key', async () => {
      const stores = [makeStore('alerts')];
      const repo = makeRepo(stores);
      const backend = makeMockBackend();
      vi.mocked(backend.get).mockResolvedValue({
        key: 'evt_123',
        appId: 'test',
        store: 'alerts',
        version: 2,
        payload: {id: 'evt_123', value: 'test'},
        meta: {computedAt: '2026-01-01', stale: false},
      });
      vi.mocked(backend.history).mockResolvedValue([]);

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores/alerts/evt_123');

      expect(res.status).toBe(200);
      expect(res.body['document']['key']).toBe('evt_123');
      expect(res.body['history']).toEqual([]);
    });

    it('returns 404 for missing document', async () => {
      const stores = [makeStore('alerts')];
      const repo = makeRepo(stores);
      const backend = makeMockBackend();
      vi.mocked(backend.get).mockResolvedValue(null);

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores/alerts/missing');

      expect(res.status).toBe(404);
    });

    it('returns 404 for unknown store', async () => {
      const repo = makeRepo([]);
      const backend = makeMockBackend();

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores/unknown/key');

      expect(res.status).toBe(404);
    });

    it('includes version history when store has history config', async () => {
      const stores = [makeStore('alerts')];
      stores[0].history = {versions: 3};
      const repo = makeRepo(stores);
      const backend = makeMockBackend();
      vi.mocked(backend.get).mockResolvedValue({
        key: 'k', appId: 'test', store: 'alerts', version: 3,
        payload: {id: 'k'}, meta: {computedAt: '2026-01-01', stale: false},
      });
      vi.mocked(backend.history).mockResolvedValue([
        {key: 'k', appId: 'test', store: 'alerts', version: 2, payload: {id: 'k'}, meta: {computedAt: '2026-01-01', stale: false}},
      ]);

      const app = createApp(repo, backend);
      const res = await request(app).get('/api/stores/alerts/k');

      expect(res.status).toBe(200);
      expect(res.body['history']).toHaveLength(1);
    });
  });
});
