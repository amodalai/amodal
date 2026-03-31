/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end tests for the stores system.
 *
 * Creates a fixture repo with store definitions → loads it → starts a real
 * Express server with PGLite → tests:
 *   1. Store definitions loaded from disk
 *   2. Store REST API (list stores, list docs, get doc)
 *   3. Agent writes via store_* tool → PGLite persists
 *   4. Agent reads via query_store tool
 *   5. Store REST API reflects what the agent wrote
 *   6. Version history works
 */

import {describe, it, expect, vi, beforeAll, afterAll, beforeEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import request from 'supertest';
import {loadRepo} from '@amodalai/core';
import type {SSEEvent} from '../types.js';
import {SSEEventType} from '../types.js';

// ── Mock the LLM provider ──
const {mockChat, mockFailoverCtor} = vi.hoisted(() => {
  const chat = vi.fn();
  const ctor = vi.fn().mockImplementation(() => ({chat}));
  return {mockChat: chat, mockFailoverCtor: ctor};
});

vi.mock('@amodalai/core', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed when core is not pre-built
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    FailoverProvider: mockFailoverCtor,
  };
});

// ── Fixture: stores ──

const ACTIVE_ALERTS_STORE = JSON.stringify({
  name: 'active-alerts',
  entity: {
    name: 'ClassifiedAlert',
    key: '{event_id}',
    schema: {
      event_id: {type: 'string'},
      severity: {type: 'enum', values: ['P1', 'P2', 'P3', 'P4']},
      category: {type: 'enum', values: ['regression', 'infrastructure', 'unknown']},
      confidence: {type: 'number', min: 0, max: 1},
      affectedService: {type: 'string'},
      reason: {type: 'string'},
    },
  },
  ttl: {
    default: 86400,
    override: [{condition: "severity IN ['P1', 'P2']", ttl: 300}],
  },
  history: {versions: 3},
  trace: true,
});

const DEAL_HEALTH_STORE = JSON.stringify({
  name: 'deal-health',
  entity: {
    name: 'DealHealthScore',
    key: '{dealId}',
    schema: {
      dealId: {type: 'string'},
      severity: {type: 'enum', values: ['healthy', 'attention', 'at_risk', 'critical']},
      score: {type: 'number', min: 0, max: 100},
    },
  },
});

const AMODAL_CONFIG = JSON.stringify({
  name: 'stores-e2e-test',
  version: '1.0.0',
  models: {
    main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
  },
});

// ── Helpers ──

function createFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stores-e2e-'));

  writeFileSync(join(dir, 'amodal.json'), AMODAL_CONFIG);

  const storesDir = join(dir, 'stores');
  mkdirSync(storesDir, {recursive: true});
  writeFileSync(join(storesDir, 'active-alerts.json'), ACTIVE_ALERTS_STORE);
  writeFileSync(join(storesDir, 'deal-health.json'), DEAL_HEALTH_STORE);

  // Create .amodal dir for PGLite data
  mkdirSync(join(dir, '.amodal'), {recursive: true});

  return dir;
}

async function collectEvents(gen: AsyncGenerator<SSEEvent>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ── Tests ──

describe('Stores E2E', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = createFixtureRepo();
  });

  afterAll(() => {
    rmSync(repoDir, {recursive: true, force: true});
  });

  beforeEach(() => {
    mockChat.mockReset();
    mockFailoverCtor.mockClear();
  });

  describe('1. Store loading from disk', () => {
    it('loads store definitions from stores/ directory', async () => {
      const repo = await loadRepo({localPath: repoDir});

      expect(repo.stores).toHaveLength(2);

      const alerts = repo.stores.find((s) => s.name === 'active-alerts');
      expect(alerts).toBeDefined();
      expect(alerts!.entity.name).toBe('ClassifiedAlert');
      expect(alerts!.entity.key).toBe('{event_id}');
      expect(Object.keys(alerts!.entity.schema)).toEqual([
        'event_id', 'severity', 'category', 'confidence', 'affectedService', 'reason',
      ]);
      expect(alerts!.trace).toBe(true);
      expect(alerts!.history).toEqual({versions: 3});

      const deals = repo.stores.find((s) => s.name === 'deal-health');
      expect(deals).toBeDefined();
      expect(deals!.entity.name).toBe('DealHealthScore');
    });
  });

  describe('2. Store REST API via Express + PGLite', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let backend: any;

    beforeAll(async () => {
      const repo = await loadRepo({localPath: repoDir});
      const {createPGLiteStoreBackend} = await import('../stores/pglite-store-backend.js');
      const {createStoresRouter} = await import('./routes/stores.js');
      const express = (await import('express')).default;

      backend = await createPGLiteStoreBackend(repo.stores);

      app = express();
      app.use(express.json());
      app.use(createStoresRouter({repo, storeBackend: backend, appId: 'local'}));
    });

    afterAll(async () => {
      if (backend) {
        await backend.close();
      }
    });

    it('GET /api/stores returns store definitions', async () => {
      const res = await request(app).get('/api/stores');
      expect(res.status).toBe(200);

      const stores = res.body['stores'] as Array<Record<string, unknown>>;
      expect(stores).toHaveLength(2);

      const alertStore = stores.find((s) => s['name'] === 'active-alerts');
      expect(alertStore).toBeDefined();
      expect(alertStore!['documentCount']).toBe(0);

      const dealStore = stores.find((s) => s['name'] === 'deal-health');
      expect(dealStore).toBeDefined();
    });

    it('GET /api/stores/:name returns empty list for new store', async () => {
      const res = await request(app).get('/api/stores/active-alerts');
      expect(res.status).toBe(200);
      expect(res.body['documents']).toEqual([]);
      expect(res.body['total']).toBe(0);
    });

    it('GET /api/stores/unknown returns 404', async () => {
      const res = await request(app).get('/api/stores/nonexistent');
      expect(res.status).toBe(404);
    });

    it('GET /api/stores/:name/:key returns 404 for missing doc', async () => {
      const res = await request(app).get('/api/stores/active-alerts/missing-key');
      expect(res.status).toBe(404);
    });
  });

  describe('3. Agent store tool execution', () => {
    it('LLM calls store_active_alerts → PGLite persists → query_store reads back', async () => {
      mockChat.mockReset();
      mockFailoverCtor.mockReset();
      mockFailoverCtor.mockImplementation(() => ({chat: mockChat}));

      const repo = await loadRepo({localPath: repoDir});

      // Verify store tools are generated
      const {storeToToolName} = await import('@amodalai/core');
      expect(storeToToolName('active-alerts')).toBe('store_active_alerts');

      // Set up mock LLM:
      // Turn 1: Call store_active_alerts to write an alert
      // Turn 2: Call query_store to read it back
      // Turn 3: Respond with text
      const writeToolCallId = 'tc_store_write_001';
      const readToolCallId = 'tc_store_read_001';

      const alertPayload = {
        event_id: 'evt_e2e_001',
        severity: 'P1',
        category: 'regression',
        confidence: 0.95,
        affectedService: 'payment-api',
        reason: 'NullPointerException after deploy d_xyz',
      };

      mockChat
        // Turn 1: Write to store
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: writeToolCallId,
            name: 'store_active_alerts',
            input: alertPayload,
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 100, outputTokens: 50},
        })
        // Turn 2: Read from store
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: readToolCallId,
            name: 'query_store',
            input: {store: 'active-alerts', key: 'evt_e2e_001'},
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 150, outputTokens: 40},
        })
        // Turn 3: Text response
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: 'Alert evt_e2e_001 classified as P1 regression affecting payment-api.',
          }],
          stopReason: 'end_turn',
          usage: {inputTokens: 200, outputTokens: 30},
        });

      // Set up session with store backend
      const {
        setupSession,
        PlanModeManager,
        prepareExploreConfig,
      } = await import('@amodalai/core');
      const {createPGLiteStoreBackend} = await import('../stores/pglite-store-backend.js');
      const {runAgentTurn} = await import('./agent-runner.js');

      const storeBackend = await createPGLiteStoreBackend(repo.stores);

      const runtime = setupSession({
        repo,
        userId: 'e2e-user',
        userRoles: [],
        isDelegated: false,
      });

      const session = {
        id: 'stores-e2e-session',
        runtime,
        appId: 'e2e-tenant',
        conversationHistory: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        planModeManager: new PlanModeManager(),
        exploreConfig: prepareExploreConfig(runtime),
        storeBackend,
      };

      // Run the agent turn
      const events = await collectEvents(
        runAgentTurn(
          session as Parameters<typeof runAgentTurn>[0],
          'Classify this alert and store it',
          AbortSignal.timeout(30000),
        ),
      );

      // Verify SSE events

      // Should have two tool_call_start events
      const toolStarts = events.filter((e) => e.type === SSEEventType.ToolCallStart);
      expect(toolStarts).toHaveLength(2);
      if (toolStarts[0].type === SSEEventType.ToolCallStart) {
        expect(toolStarts[0].tool_name).toBe('store_active_alerts');
      }
      if (toolStarts[1].type === SSEEventType.ToolCallStart) {
        expect(toolStarts[1].tool_name).toBe('query_store');
      }

      // Should have two tool_call_result events — both success
      const toolResults = events.filter((e) => e.type === SSEEventType.ToolCallResult);
      expect(toolResults).toHaveLength(2);

      // First result: store write
      if (toolResults[0].type === SSEEventType.ToolCallResult) {
        expect(toolResults[0].status).toBe('success');
        const writeResult = JSON.parse(toolResults[0].result ?? '{}');
        expect(writeResult['stored']).toBe(true);
        expect(writeResult['key']).toBe('evt_e2e_001');
        expect(writeResult['version']).toBe(1);
      }

      // Second result: store read
      if (toolResults[1].type === SSEEventType.ToolCallResult) {
        expect(toolResults[1].status).toBe('success');
        const readResult = JSON.parse(toolResults[1].result ?? '{}');
        expect(readResult['found']).toBe(true);
        expect(readResult['payload']['severity']).toBe('P1');
        expect(readResult['payload']['affectedService']).toBe('payment-api');
      }

      // Should end with text + done
      const textEvents = events.filter((e) => e.type === SSEEventType.TextDelta);
      expect(textEvents.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe(SSEEventType.Done);

      // Verify PGLite persistence — data survives beyond the session
      const doc = await storeBackend.get('e2e-tenant', 'active-alerts', 'evt_e2e_001');
      expect(doc).not.toBeNull();
      expect(doc!.payload['severity']).toBe('P1');
      expect(doc!.version).toBe(1);
      expect(doc!.meta.computedAt).toBeDefined();

      // Verify TTL was resolved (P1 → 300s override)
      expect(doc!.meta.ttl).toBe(300);

      // Clean up
      await storeBackend.close();
    }, 30000);
  });

  describe('4. Version history', () => {
    it('updating a document creates version history', async () => {
      const repo = await loadRepo({localPath: repoDir});
      const {createPGLiteStoreBackend} = await import('../stores/pglite-store-backend.js');
      const backend = await createPGLiteStoreBackend(repo.stores);

      // Write v1
      await backend.put('t', 'active-alerts', 'evt_hist_001', {
        event_id: 'evt_hist_001', severity: 'P3', category: 'unknown',
        confidence: 0.5, affectedService: 'api', reason: 'initial',
      }, {});

      // Write v2
      await backend.put('t', 'active-alerts', 'evt_hist_001', {
        event_id: 'evt_hist_001', severity: 'P2', category: 'regression',
        confidence: 0.8, affectedService: 'api', reason: 'escalated',
      }, {});

      // Write v3
      await backend.put('t', 'active-alerts', 'evt_hist_001', {
        event_id: 'evt_hist_001', severity: 'P1', category: 'regression',
        confidence: 0.95, affectedService: 'api', reason: 'confirmed regression',
      }, {});

      // Current should be v3
      const current = await backend.get('t', 'active-alerts', 'evt_hist_001');
      expect(current!.version).toBe(3);
      expect(current!.payload['severity']).toBe('P1');

      // History should have v1 and v2 (maxVersions=3, current is v3, so v1 and v2 in history)
      const history = await backend.history('t', 'active-alerts', 'evt_hist_001');
      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(2);
      expect(history[0].payload['severity']).toBe('P2');
      expect(history[1].version).toBe(1);
      expect(history[1].payload['severity']).toBe('P3');

      await backend.close();
    });
  });

  describe('5. Store tools appear in LLM tool list', () => {
    it('buildTools includes store_* and query_store tools', async () => {
      const repo = await loadRepo({localPath: repoDir});

      mockChat.mockResolvedValueOnce({
        content: [{type: 'text', text: 'Hello'}],
        stopReason: 'end_turn',
        usage: {inputTokens: 10, outputTokens: 5},
      });

      const {setupSession, PlanModeManager, prepareExploreConfig} = await import('@amodalai/core');
      const {runAgentTurn} = await import('./agent-runner.js');

      const runtime = setupSession({
        repo,
        userId: 'test',
        userRoles: [],
        isDelegated: false,
      });

      const session = {
        id: 'tools-check-session',
        runtime,
        appId: 'test',
        conversationHistory: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        planModeManager: new PlanModeManager(),
        exploreConfig: prepareExploreConfig(runtime),
      };

      await collectEvents(
        runAgentTurn(
          session as Parameters<typeof runAgentTurn>[0],
          'hi',
          AbortSignal.timeout(10000),
        ),
      );

      // Check that the LLM was called with store tools
      if (mockChat.mock.calls.length > 0) {
        const chatArgs = mockChat.mock.calls[0][0] as Record<string, unknown>;
        const tools = chatArgs['tools'] as Array<{name: string}>;
        const toolNames = tools.map((t) => t.name);

        // Per-store write tools
        expect(toolNames).toContain('store_active_alerts');
        expect(toolNames).toContain('store_deal_health');

        // Single query tool
        expect(toolNames).toContain('query_store');

        // Built-in tools still present
        expect(toolNames).toContain('request');
        expect(toolNames).toContain('explore');
      }
    }, 15000);
  });

  describe('6. Store REST API after agent writes', () => {
    it('REST API reflects documents written by agent tool', async () => {
      const repo = await loadRepo({localPath: repoDir});
      const {createPGLiteStoreBackend} = await import('../stores/pglite-store-backend.js');
      const {createStoresRouter} = await import('./routes/stores.js');

      const backend = await createPGLiteStoreBackend(repo.stores);

      // Write some documents directly (simulating agent writes)
      await backend.put('local', 'active-alerts', 'evt_api_001', {
        event_id: 'evt_api_001', severity: 'P1', category: 'regression',
        confidence: 0.9, affectedService: 'payments', reason: 'deploy failure',
      }, {});
      await backend.put('local', 'active-alerts', 'evt_api_002', {
        event_id: 'evt_api_002', severity: 'P3', category: 'infrastructure',
        confidence: 0.6, affectedService: 'cdn', reason: 'cache miss spike',
      }, {});
      await backend.put('local', 'deal-health', 'deal_001', {
        dealId: 'deal_001', severity: 'at_risk', score: 35,
      }, {});

      // Create Express app with store routes
      const express = (await import('express')).default;
      const testApp = express();
      testApp.use(express.json());
      testApp.use(createStoresRouter({repo, storeBackend: backend, appId: 'local'}));

      // GET /api/stores — should show correct counts
      const storesRes = await request(testApp).get('/api/stores');
      expect(storesRes.status).toBe(200);
      const stores = storesRes.body['stores'] as Array<Record<string, unknown>>;
      const alertStore = stores.find((s) => s['name'] === 'active-alerts');
      expect(alertStore!['documentCount']).toBe(2);
      const dealStore = stores.find((s) => s['name'] === 'deal-health');
      expect(dealStore!['documentCount']).toBe(1);

      // GET /api/stores/active-alerts — should list both alerts
      const listRes = await request(testApp).get('/api/stores/active-alerts');
      expect(listRes.status).toBe(200);
      expect(listRes.body['total']).toBe(2);
      expect(listRes.body['documents']).toHaveLength(2);

      // GET /api/stores/active-alerts with filter
      const filterRes = await request(testApp)
        .get('/api/stores/active-alerts')
        .query({filter: '{"severity":"P1"}'});
      expect(filterRes.status).toBe(200);
      expect(filterRes.body['total']).toBe(1);
      expect(filterRes.body['documents'][0]['payload']['event_id']).toBe('evt_api_001');

      // GET /api/stores/active-alerts/:key — should return specific doc
      const docRes = await request(testApp).get('/api/stores/active-alerts/evt_api_001');
      expect(docRes.status).toBe(200);
      expect(docRes.body['document']['payload']['severity']).toBe('P1');
      expect(docRes.body['document']['version']).toBe(1);

      // GET /api/stores/deal-health/deal_001
      const dealRes = await request(testApp).get('/api/stores/deal-health/deal_001');
      expect(dealRes.status).toBe(200);
      expect(dealRes.body['document']['payload']['score']).toBe(35);

      await backend.close();
    });
  });
});
