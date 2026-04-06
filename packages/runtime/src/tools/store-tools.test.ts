/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {LoadedStore, StoreBackend, StoreDocument, StorePutResult} from '@amodalai/types';
import {
  createStoreWriteTool,
  createStoreBatchTool,
  createStoreQueryTool,
  registerStoreTools,
  storeToToolName,
  QUERY_STORE_TOOL_NAME,
} from './store-tools.js';
import {createToolRegistry} from './registry.js';
import {StoreError} from '../errors.js';
import type {ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALERTS_STORE: LoadedStore = {
  name: 'alerts',
  entity: {
    name: 'Alert',
    key: '{alert_id}',
    schema: {
      alert_id: {type: 'string'},
      severity: {type: 'enum', values: ['P1', 'P2', 'P3']},
      message: {type: 'string'},
    },
  },
  location: '/tmp/test',
};

const mockCtx: ToolContext = {
  request: vi.fn(),
  store: vi.fn(),
  env: vi.fn(),
  log: vi.fn(),
  signal: AbortSignal.timeout(5000),
  sessionId: 'test-session',
};

function createMockBackend(): StoreBackend {
  const docs = new Map<string, StoreDocument>();

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockImplementation(async (_appId: string, _store: string, key: string) => docs.get(key) ?? null),
    put: vi.fn().mockImplementation(async (_appId: string, store: string, key: string, payload: Record<string, unknown>) => {
      const doc: StoreDocument = {
        key,
        appId: 'test',
        store,
        version: 1,
        payload,
        meta: {computedAt: new Date().toISOString(), stale: false},
      };
      docs.set(key, doc);
      const result: StorePutResult = {stored: true, key, version: 1};
      return result;
    }),
    list: vi.fn().mockImplementation(async () => ({documents: [...docs.values()], total: docs.size, hasMore: false})),
    delete: vi.fn().mockResolvedValue(true),
    history: vi.fn().mockResolvedValue([]),
    purgeExpired: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('storeToToolName', () => {
  it('converts kebab-case to snake_case with store_ prefix', () => {
    expect(storeToToolName('active-alerts')).toBe('store_active_alerts');
    expect(storeToToolName('incidents')).toBe('store_incidents');
  });
});

describe('createStoreWriteTool', () => {
  let backend: StoreBackend;

  beforeEach(() => {
    backend = createMockBackend();
  });

  it('creates a write tool with correct metadata', () => {
    const tool = createStoreWriteTool(ALERTS_STORE, backend, 'test-app');

    expect(tool.description).toContain('Alert');
    expect(tool.description).toContain('alerts');
    expect(tool.readOnly).toBe(false);
    expect(tool.metadata?.category).toBe('store');
  });

  it('writes a document with resolved key', async () => {
    const tool = createStoreWriteTool(ALERTS_STORE, backend, 'test-app');

    const result = await tool.execute(
      {alert_id: 'a1', severity: 'P1', message: 'disk full'},
      mockCtx,
    );

    expect(backend.put).toHaveBeenCalledWith(
      'test-app', 'alerts', 'a1',
      {alert_id: 'a1', severity: 'P1', message: 'disk full'},
      {},
    );
    expect(result).toEqual({stored: true, key: 'a1', version: 1});
  });

  it('throws StoreError when key field is missing', async () => {
    const tool = createStoreWriteTool(ALERTS_STORE, backend, 'test-app');

    await expect(
      tool.execute({severity: 'P1', message: 'no id'}, mockCtx),
    ).rejects.toThrow(StoreError);
  });
});

describe('createStoreBatchTool', () => {
  let backend: StoreBackend;

  beforeEach(() => {
    backend = createMockBackend();
  });

  it('creates a batch tool with correct metadata', () => {
    const tool = createStoreBatchTool(ALERTS_STORE, backend, 'test-app');

    expect(tool.description).toContain('multiple');
    expect(tool.readOnly).toBe(false);
    expect(tool.metadata?.category).toBe('store');
  });

  it('writes multiple documents', async () => {
    const tool = createStoreBatchTool(ALERTS_STORE, backend, 'test-app');

    const result = await tool.execute({
      items: [
        {alert_id: 'a1', severity: 'P1', message: 'first'},
        {alert_id: 'a2', severity: 'P2', message: 'second'},
      ],
    }, mockCtx);

    expect(backend.put).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({stored: 2, failed: 0, total: 2});
  });

  it('reports partial failures without throwing', async () => {
    const failBackend = createMockBackend();
    let callCount = 0;
    failBackend.put = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error('write failed');
      return {stored: true, key: 'k', version: 1};
    });

    const tool = createStoreBatchTool(ALERTS_STORE, failBackend, 'test-app');

    const result = await tool.execute({
      items: [
        {alert_id: 'a1', severity: 'P1', message: 'ok'},
        {alert_id: 'a2', severity: 'P2', message: 'fail'},
        {alert_id: 'a3', severity: 'P3', message: 'ok'},
      ],
    }, mockCtx) as Record<string, unknown>;

    expect(result['stored']).toBe(2);
    expect(result['failed']).toBe(1);
    expect(result['errors']).toEqual(['write failed']);
  });
});

describe('createStoreQueryTool', () => {
  let backend: StoreBackend;

  beforeEach(() => {
    backend = createMockBackend();
  });

  it('creates a query tool that is readOnly', () => {
    const tool = createStoreQueryTool([ALERTS_STORE], backend, 'test-app');

    expect(tool.readOnly).toBe(true);
    expect(tool.metadata?.category).toBe('store');
  });

  it('gets a single document by key', async () => {
    // Pre-populate
    await backend.put('test-app', 'alerts', 'a1', {alert_id: 'a1', severity: 'P1'}, {});

    const tool = createStoreQueryTool([ALERTS_STORE], backend, 'test-app');
    const result = await tool.execute({store: 'alerts', key: 'a1'}, mockCtx) as Record<string, unknown>;

    expect(result['found']).toBe(true);
    expect(result['key']).toBe('a1');
  });

  it('returns found: false for missing document', async () => {
    const tool = createStoreQueryTool([ALERTS_STORE], backend, 'test-app');
    const result = await tool.execute({store: 'alerts', key: 'missing'}, mockCtx) as Record<string, unknown>;

    expect(result['found']).toBe(false);
  });

  it('lists documents with default limit', async () => {
    await backend.put('test-app', 'alerts', 'a1', {alert_id: 'a1'}, {});
    await backend.put('test-app', 'alerts', 'a2', {alert_id: 'a2'}, {});

    const tool = createStoreQueryTool([ALERTS_STORE], backend, 'test-app');
    const result = await tool.execute({store: 'alerts'}, mockCtx) as Record<string, unknown>;

    expect(result).toHaveProperty('documents');
    expect(result).toHaveProperty('total');
  });

  it('passes filter and sort to backend', async () => {
    const tool = createStoreQueryTool([ALERTS_STORE], backend, 'test-app');
    await tool.execute({
      store: 'alerts',
      filter: {severity: 'P1'},
      sort: '-severity',
      limit: 5,
    }, mockCtx);

    expect(backend.list).toHaveBeenCalledWith('test-app', 'alerts', {
      filter: {severity: 'P1'},
      sort: '-severity',
      limit: 5,
    });
  });
});

describe('registerStoreTools', () => {
  it('registers write, batch, and query tools for each store', () => {
    const registry = createToolRegistry();
    const backend = createMockBackend();

    registerStoreTools(registry, [ALERTS_STORE], backend, 'test-app');

    expect(registry.names()).toContain('store_alerts');
    expect(registry.names()).toContain('store_alerts_batch');
    expect(registry.names()).toContain(QUERY_STORE_TOOL_NAME);
    expect(registry.size).toBe(3);
  });

  it('registers tools for multiple stores', () => {
    const registry = createToolRegistry();
    const backend = createMockBackend();
    const secondStore: LoadedStore = {
      ...ALERTS_STORE,
      name: 'incidents',
      entity: {...ALERTS_STORE.entity, name: 'Incident', key: '{id}', schema: {id: {type: 'string'}}},
    };

    registerStoreTools(registry, [ALERTS_STORE, secondStore], backend, 'test-app');

    expect(registry.names()).toContain('store_alerts');
    expect(registry.names()).toContain('store_alerts_batch');
    expect(registry.names()).toContain('store_incidents');
    expect(registry.names()).toContain('store_incidents_batch');
    expect(registry.names()).toContain(QUERY_STORE_TOOL_NAME);
    expect(registry.size).toBe(5);
  });

  it('does not register query tool when no stores', () => {
    const registry = createToolRegistry();
    const backend = createMockBackend();

    registerStoreTools(registry, [], backend, 'test-app');

    expect(registry.size).toBe(0);
  });
});
