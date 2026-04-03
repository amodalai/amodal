/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Integration test: store tools through the upstream bridge.
 *
 * Verifies that store write, batch write, and query work correctly
 * when registered via bridgeToUpstream (the path used in production
 * with the GeminiClient).
 */

import {describe, it, expect, vi, beforeAll} from 'vitest';
import {createStoreWriteTool, createStoreBatchTool, createStoreQueryTool, storeToToolName} from './store-tools.js';
import {bridgeToUpstream, extractJsonSchema} from './upstream-bridge.js';
import type {ToolContext} from './types.js';
import type {LoadedStore, StoreBackend} from '@amodalai/types';

// ---------------------------------------------------------------------------
// In-memory store backend (test mock — uses unknown casts for brevity)
// ---------------------------------------------------------------------------

function createInMemoryBackend(): StoreBackend {
  const data = new Map<string, Map<string, Record<string, unknown>>>();

  function getStore(appId: string, store: string) {
    const key = `${appId}:${store}`;
    if (!data.has(key)) data.set(key, new Map());
    return data.get(key)!;  
  }

   
  return {
    async put(_appId: string, _store: string, key: string, payload: Record<string, unknown>) {
      getStore(_appId, _store).set(key, payload);
      return {stored: true, key, version: 1};
    },
    async get(appId: string, store: string, key: string) {
      const payload = getStore(appId, store).get(key);
      if (!payload) return null;
      return {key, payload, meta: {computedAt: new Date().toISOString(), stale: false}, version: 1, store, appId};
    },
    async list(appId: string, store: string, opts?: {filter?: Record<string, unknown>; limit?: number}) {
      const storeData = getStore(appId, store);
      let docs = Array.from(storeData.entries()).map(([k, payload]) => ({
        key: k, payload, meta: {computedAt: new Date().toISOString(), stale: false}, version: 1, store, appId,
      }));
      if (opts?.filter) {
        for (const [field, value] of Object.entries(opts.filter)) {
          docs = docs.filter((d) => d.payload[field] === value);
        }
      }
      const limited = docs.slice(0, opts?.limit ?? 20);
      return {documents: limited, total: docs.length, hasMore: docs.length > limited.length};
    },
    async delete() { return true; },
    async history() { return []; },
    async initialize() { /* no-op */ },
    async close() { /* no-op */ },
    async purgeExpired() { return 0; },
  } as unknown as StoreBackend;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

 
const STORE_DEF = {
  name: 'trending-topics',
  entity: {
    name: 'trending_topic',
    key: '{topic_id}',
    schema: {
      topic_id: {type: 'string'},
      title: {type: 'string'},
      source: {type: 'string'},
      score: {type: 'number'},
    },
  },
} as unknown as LoadedStore;

const APP_ID = 'test-app';

function makeCtx(): ToolContext {
  return {
    request: vi.fn(),
    store: vi.fn(),
    env: vi.fn(),
    log: vi.fn(),
    user: {roles: []},
    signal: AbortSignal.timeout(10000),
    sessionId: 'test',
    tenantId: 'test',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Store tools through upstream bridge', () => {
  let backend: StoreBackend;

  beforeAll(() => {
    backend = createInMemoryBackend();
  });

  it('single write → query reads it back', async () => {
    const writeDef = createStoreWriteTool(STORE_DEF, backend, APP_ID);
    const queryDef = createStoreQueryTool([STORE_DEF], backend, APP_ID);

    const writeBridge = bridgeToUpstream(
      storeToToolName(STORE_DEF.name), writeDef, extractJsonSchema(writeDef), makeCtx,
    ) as { validateBuildAndExecute(p: Record<string, unknown>): Promise<{llmContent: string}> };

    const queryBridge = bridgeToUpstream(
      'query_store', queryDef, extractJsonSchema(queryDef), makeCtx,
    ) as { validateBuildAndExecute(p: Record<string, unknown>): Promise<{llmContent: string}> };

    // Write
    const writeResult = await writeBridge.validateBuildAndExecute({
      topic_id: 'ai-agents-2026',
      title: 'AI Agents Are Everywhere',
      source: 'hackernews',
      score: 95,
    });
    expect(writeResult.llmContent).not.toContain('Error');

    // Query
    const queryResult = await queryBridge.validateBuildAndExecute({
      store: 'trending-topics',
    });
    const parsed = JSON.parse(queryResult.llmContent) as {documents: Array<{payload: Record<string, unknown>}>; total: number};
    expect(parsed.total).toBe(1);
    expect(parsed.documents[0].payload['title']).toBe('AI Agents Are Everywhere');
  });

  it('batch write → query reads all items back', async () => {
    const batchBackend = createInMemoryBackend();
    const batchDef = createStoreBatchTool(STORE_DEF, batchBackend, APP_ID);
    const queryDef = createStoreQueryTool([STORE_DEF], batchBackend, APP_ID);

    const batchBridge = bridgeToUpstream(
      `${storeToToolName(STORE_DEF.name)}_batch`, batchDef, extractJsonSchema(batchDef), makeCtx,
    ) as { validateBuildAndExecute(p: Record<string, unknown>): Promise<{llmContent: string}> };

    const queryBridge = bridgeToUpstream(
      'query_store', queryDef, extractJsonSchema(queryDef), makeCtx,
    ) as { validateBuildAndExecute(p: Record<string, unknown>): Promise<{llmContent: string}> };

    // Batch write
    const batchResult = await batchBridge.validateBuildAndExecute({
      items: [
        {topic_id: 'mcp-protocol', title: 'MCP Protocol Adoption', source: 'twitter', score: 88},
        {topic_id: 'ai-sdk-v6', title: 'AI SDK v6 Released', source: 'vercel-blog', score: 92},
        {topic_id: 'claude-code', title: 'Claude Code Launch', source: 'anthropic', score: 97},
      ],
    });
    const batchParsed = JSON.parse(batchResult.llmContent) as {stored: number; failed: number};
    expect(batchParsed.stored).toBe(3);
    expect(batchParsed.failed).toBe(0);

    // Query all
    const queryResult = await queryBridge.validateBuildAndExecute({
      store: 'trending-topics',
    });
    const queryParsed = JSON.parse(queryResult.llmContent) as {documents: unknown[]; total: number};
    expect(queryParsed.total).toBe(3);
  });

  it('query with filter returns only matching items', async () => {
    const filterBackend = createInMemoryBackend();
    const writeDef = createStoreWriteTool(STORE_DEF, filterBackend, APP_ID);
    const queryDef = createStoreQueryTool([STORE_DEF], filterBackend, APP_ID);

    const writeBridge = bridgeToUpstream(
      storeToToolName(STORE_DEF.name), writeDef, extractJsonSchema(writeDef), makeCtx,
    ) as { validateBuildAndExecute(p: Record<string, unknown>): Promise<{llmContent: string}> };

    const queryBridge = bridgeToUpstream(
      'query_store', queryDef, extractJsonSchema(queryDef), makeCtx,
    ) as { validateBuildAndExecute(p: Record<string, unknown>): Promise<{llmContent: string}> };

    // Write two items with different sources
    await writeBridge.validateBuildAndExecute({
      topic_id: 'a', title: 'From HN', source: 'hackernews', score: 80,
    });
    await writeBridge.validateBuildAndExecute({
      topic_id: 'b', title: 'From Twitter', source: 'twitter', score: 90,
    });

    // Filter by source
    const result = await queryBridge.validateBuildAndExecute({
      store: 'trending-topics',
      filter: {source: 'twitter'},
    });
    const parsed = JSON.parse(result.llmContent) as {documents: Array<{payload: Record<string, unknown>}>; total: number};
    expect(parsed.total).toBe(1);
    expect(parsed.documents[0].payload['source']).toBe('twitter');
  });

  it('extractJsonSchema produces real schemas for store tools', () => {
    const writeDef = createStoreWriteTool(STORE_DEF, backend, APP_ID);
    const schema = extractJsonSchema(writeDef);

    expect(schema['type']).toBe('object');
    const props = schema['properties'] as Record<string, unknown>;
    expect(props).toBeDefined();
    expect(props['topic_id']).toBeDefined();
    expect(props['title']).toBeDefined();
  });
});
