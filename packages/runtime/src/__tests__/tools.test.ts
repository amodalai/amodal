/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 0.6 — Tool Execution Integration Tests
 *
 * Parity tests that verify tool execution end-to-end through the current
 * gemini-cli-core system. If a future SDK swap breaks tool behaviour,
 * these tests catch it immediately.
 *
 * Scenarios:
 *   1. Store write → read back → verify data
 *   2. Store batch write → query → verify all items
 *   3. Store query with filter → verify filtered result
 *   4. Custom tool (handler) → verify execution and structured return
 *   5. Connection request tool → verify API call with auth headers
 */

import {describe, it, expect, vi, beforeAll, afterAll, beforeEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer, type Server} from 'node:http';
import {loadRepo} from '@amodalai/core';
import type {StoreBackend} from '@amodalai/core';
import type {SSEEvent} from '../types.js';
import {SSEEventType} from '../types.js';
import type {PGLiteStoreBackend} from '../stores/pglite-store-backend.js';

// ── Mock the LLM provider ──────────────────────────────────────────────────

const {mockChat, mockFailoverCtor} = vi.hoisted(() => {
  const chat = vi.fn();
  const ctor = vi.fn().mockImplementation(() => ({chat}));
  return {mockChat: chat, mockFailoverCtor: ctor};
});

vi.mock('@amodalai/core', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed when core is not pre-built
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    FailoverProvider: mockFailoverCtor,
  };
});

// ── Fixture: amodal.json ────────────────────────────────────────────────────

const AMODAL_CONFIG = JSON.stringify({
  name: 'tool-integration-test',
  version: '1.0.0',
  models: {
    main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
  },
});

// ── Fixture: store definition ───────────────────────────────────────────────

const INCIDENTS_STORE = JSON.stringify({
  name: 'incidents',
  entity: {
    name: 'Incident',
    key: '{incident_id}',
    schema: {
      incident_id: {type: 'string'},
      severity: {type: 'enum', values: ['P1', 'P2', 'P3', 'P4']},
      service: {type: 'string'},
      status: {type: 'enum', values: ['open', 'investigating', 'resolved']},
      summary: {type: 'string'},
    },
  },
  history: {versions: 3},
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function createFixtureRepo(opts?: {
  connections?: Record<string, unknown>;
  customTools?: Record<string, Record<string, string>>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'tools-int-'));

  writeFileSync(join(dir, 'amodal.json'), AMODAL_CONFIG);

  // Stores
  mkdirSync(join(dir, 'stores'), {recursive: true});
  writeFileSync(join(dir, 'stores', 'incidents.json'), INCIDENTS_STORE);

  // .amodal dir for PGLite data
  mkdirSync(join(dir, '.amodal'), {recursive: true});

  // Connections
  if (opts?.connections) {
    const configWithConns = {
      ...JSON.parse(AMODAL_CONFIG) as Record<string, unknown>,
      connections: opts.connections,
    };
    writeFileSync(join(dir, 'amodal.json'), JSON.stringify(configWithConns));
  }

  // Custom tools
  if (opts?.customTools) {
    for (const [name, files] of Object.entries(opts.customTools)) {
      const toolDir = join(dir, 'tools', name);
      mkdirSync(toolDir, {recursive: true});
      for (const [filename, content] of Object.entries(files)) {
        writeFileSync(join(toolDir, filename), content);
      }
    }
  }

  return dir;
}

async function collectEvents(gen: AsyncGenerator<SSEEvent>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

async function buildSession(repoDir: string, extraOpts?: {
  connectionsMap?: Record<string, unknown>;
}) {
  const repo = await loadRepo({localPath: repoDir});

  const {setupSession, PlanModeManager, prepareExploreConfig} = await import('@amodalai/core');
  const {createPGLiteStoreBackend} = await import('../stores/pglite-store-backend.js');

  const storeBackend: PGLiteStoreBackend = await createPGLiteStoreBackend(repo.stores);

  const runtime = setupSession({
    repo,
    userId: 'integration-test-user',
    userRoles: [],
    isDelegated: false,
  });

  const session = {
    id: 'tools-int-session',
    runtime: {
      ...runtime,
      connectionsMap: extraOpts?.connectionsMap ?? {},
    },
    appId: 'int-test-tenant',
    conversationHistory: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    planModeManager: new PlanModeManager(),
    exploreConfig: prepareExploreConfig(runtime),
    storeBackend: storeBackend as StoreBackend,
  };

  return {session, repo, storeBackend};
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Tool Execution Integration Tests', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = createFixtureRepo();
  });

  afterAll(() => {
    rmSync(repoDir, {recursive: true, force: true});
  });

  beforeEach(() => {
    mockChat.mockReset();
    mockFailoverCtor.mockReset();
    mockFailoverCtor.mockImplementation(() => ({chat: mockChat}));
  });

  // ────────────────────────────────────────────────────────────────────────
  // 1. Store write → read back → verify data
  // ────────────────────────────────────────────────────────────────────────

  describe('1. Store write → read back → verify data', () => {
    it('writes a document via store tool, reads it back via query_store, and verifies all fields', async () => {
      const {session, storeBackend} = await buildSession(repoDir);
      const {runAgentTurn} = await import('../agent/agent-runner.js');

      const incidentPayload = {
        incident_id: 'inc_001',
        severity: 'P1',
        service: 'payment-api',
        status: 'open',
        summary: 'Latency spike after deploy v2.3.1',
      };

      // Turn 1: LLM calls store_incidents to write
      mockChat
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: 'tc_write_001',
            name: 'store_incidents',
            input: incidentPayload,
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 100, outputTokens: 50},
        })
        // Turn 2: LLM calls query_store to read back
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: 'tc_read_001',
            name: 'query_store',
            input: {store: 'incidents', key: 'inc_001'},
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 150, outputTokens: 40},
        })
        // Turn 3: Text response
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Incident inc_001 stored and verified.'}],
          stopReason: 'end_turn',
          usage: {inputTokens: 200, outputTokens: 20},
        });

      const events = await collectEvents(
        runAgentTurn(
          session as Parameters<typeof runAgentTurn>[0],
          'Store this incident and read it back',
          AbortSignal.timeout(30000),
        ),
      );

      // Verify tool call events
      const toolResults = events.filter((e) => e.type === SSEEventType.ToolCallResult);
      expect(toolResults).toHaveLength(2);

      // Write result
      if (toolResults[0].type === SSEEventType.ToolCallResult) {
        expect(toolResults[0].status).toBe('success');
        const writeResult = JSON.parse(toolResults[0].result ?? '{}') as Record<string, unknown>;
        expect(writeResult['stored']).toBe(true);
        expect(writeResult['key']).toBe('inc_001');
        expect(writeResult['version']).toBe(1);
      }

      // Read result — verify all fields preserved
      if (toolResults[1].type === SSEEventType.ToolCallResult) {
        expect(toolResults[1].status).toBe('success');
        const readResult = JSON.parse(toolResults[1].result ?? '{}') as Record<string, unknown>;
        expect(readResult['found']).toBe(true);
        const payload = readResult['payload'] as Record<string, unknown>;
        expect(payload['incident_id']).toBe('inc_001');
        expect(payload['severity']).toBe('P1');
        expect(payload['service']).toBe('payment-api');
        expect(payload['status']).toBe('open');
        expect(payload['summary']).toBe('Latency spike after deploy v2.3.1');
      }

      // Verify direct PGLite persistence
      const doc = await storeBackend.get('int-test-tenant', 'incidents', 'inc_001');
      expect(doc).not.toBeNull();
      expect(doc!.payload['severity']).toBe('P1');
      expect(doc!.payload['service']).toBe('payment-api');
      expect(doc!.version).toBe(1);

      await storeBackend.close();
    }, 30000);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Store batch write → query → verify all items
  // ────────────────────────────────────────────────────────────────────────

  describe('2. Store batch write → query → verify all items', () => {
    it('writes multiple documents then lists them all via query_store', async () => {
      const {session, storeBackend} = await buildSession(repoDir);
      const {runAgentTurn} = await import('../agent/agent-runner.js');

      const incidents = [
        {incident_id: 'inc_batch_1', severity: 'P1', service: 'auth', status: 'open', summary: 'Auth down'},
        {incident_id: 'inc_batch_2', severity: 'P3', service: 'cdn', status: 'investigating', summary: 'Cache miss'},
        {incident_id: 'inc_batch_3', severity: 'P2', service: 'payments', status: 'open', summary: 'Slow txns'},
      ];

      // Turn 1-3: LLM writes each incident
      // Turn 4: LLM queries all incidents
      // Turn 5: Text response
      for (const incident of incidents) {
        mockChat.mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: `tc_batch_${incident.incident_id}`,
            name: 'store_incidents',
            input: incident,
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 100, outputTokens: 50},
        });
      }

      mockChat
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: 'tc_list_all',
            name: 'query_store',
            input: {store: 'incidents'},
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 200, outputTokens: 40},
        })
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'All incidents stored and listed.'}],
          stopReason: 'end_turn',
          usage: {inputTokens: 300, outputTokens: 20},
        });

      const events = await collectEvents(
        runAgentTurn(
          session as Parameters<typeof runAgentTurn>[0],
          'Store these three incidents then list them all',
          AbortSignal.timeout(30000),
        ),
      );

      // Should have 4 tool results (3 writes + 1 list)
      const toolResults = events.filter((e) => e.type === SSEEventType.ToolCallResult);
      expect(toolResults).toHaveLength(4);

      // All writes should succeed
      for (let i = 0; i < 3; i++) {
        if (toolResults[i].type === SSEEventType.ToolCallResult) {
          expect(toolResults[i].status).toBe('success');
          const r = JSON.parse(toolResults[i].result ?? '{}') as Record<string, unknown>;
          expect(r['stored']).toBe(true);
        }
      }

      // List result should contain all 3 documents
      if (toolResults[3].type === SSEEventType.ToolCallResult) {
        expect(toolResults[3].status).toBe('success');
        const listResult = JSON.parse(toolResults[3].result ?? '{}') as Record<string, unknown>;
        const docs = listResult['documents'] as Array<Record<string, unknown>>;
        expect(docs).toHaveLength(3);

        const ids = docs.map((d) => (d['payload'] as Record<string, unknown>)['incident_id']).sort();
        expect(ids).toEqual(['inc_batch_1', 'inc_batch_2', 'inc_batch_3']);
      }

      // Verify direct backend has all 3
      const backendList = await storeBackend.list('int-test-tenant', 'incidents', {});
      expect(backendList.documents).toHaveLength(3);

      await storeBackend.close();
    }, 30000);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Store query with filter → verify filtered result
  // ────────────────────────────────────────────────────────────────────────

  describe('3. Store query with filter → verify filtered result', () => {
    it('writes documents with different severities, queries with filter, only matching items returned', async () => {
      const {session, storeBackend} = await buildSession(repoDir);
      const {runAgentTurn} = await import('../agent/agent-runner.js');

      const incidents = [
        {incident_id: 'inc_f1', severity: 'P1', service: 'api', status: 'open', summary: 'Critical'},
        {incident_id: 'inc_f2', severity: 'P3', service: 'web', status: 'resolved', summary: 'Minor'},
        {incident_id: 'inc_f3', severity: 'P1', service: 'db', status: 'investigating', summary: 'DB down'},
        {incident_id: 'inc_f4', severity: 'P4', service: 'docs', status: 'open', summary: 'Typo'},
      ];

      // Write all 4 incidents
      for (const incident of incidents) {
        mockChat.mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: `tc_f_${incident.incident_id}`,
            name: 'store_incidents',
            input: incident,
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 100, outputTokens: 50},
        });
      }

      // Query with severity filter
      mockChat
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: 'tc_filter_query',
            name: 'query_store',
            input: {store: 'incidents', filter: {severity: 'P1'}},
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 200, outputTokens: 40},
        })
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Found 2 P1 incidents.'}],
          stopReason: 'end_turn',
          usage: {inputTokens: 250, outputTokens: 15},
        });

      const events = await collectEvents(
        runAgentTurn(
          session as Parameters<typeof runAgentTurn>[0],
          'Store these incidents and show me only P1s',
          AbortSignal.timeout(30000),
        ),
      );

      // 4 writes + 1 filtered query
      const toolResults = events.filter((e) => e.type === SSEEventType.ToolCallResult);
      expect(toolResults).toHaveLength(5);

      // Filter result should only contain P1 incidents
      if (toolResults[4].type === SSEEventType.ToolCallResult) {
        expect(toolResults[4].status).toBe('success');
        const filterResult = JSON.parse(toolResults[4].result ?? '{}') as Record<string, unknown>;
        const docs = filterResult['documents'] as Array<Record<string, unknown>>;
        expect(docs).toHaveLength(2);

        const ids = docs.map((d) => (d['payload'] as Record<string, unknown>)['incident_id']).sort();
        expect(ids).toEqual(['inc_f1', 'inc_f3']);

        // All returned docs should be P1
        for (const doc of docs) {
          expect((doc['payload'] as Record<string, unknown>)['severity']).toBe('P1');
        }
      }

      await storeBackend.close();
    }, 30000);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. Custom tool → verify execution and structured return
  // ────────────────────────────────────────────────────────────────────────

  describe('4. Custom tool execution → structured return', () => {
    it('executes a custom tool handler and returns structured data through the agent loop', async () => {
      const customRepoDir = createFixtureRepo({
        customTools: {
          risk_scorer: {
            'tool.json': JSON.stringify({
              description: 'Score risk for a deal',
              parameters: {
                type: 'object',
                properties: {
                  deal_id: {type: 'string'},
                  revenue: {type: 'number'},
                  days_stale: {type: 'number'},
                },
                required: ['deal_id', 'revenue', 'days_stale'],
              },
            }),
            'handler.mjs': `
export default async (params) => {
  const score = params.days_stale > 30 ? 'at_risk' : params.revenue > 100000 ? 'healthy' : 'attention';
  return {
    deal_id: params.deal_id,
    risk_score: score,
    factors: {
      days_stale: params.days_stale,
      revenue: params.revenue,
    },
  };
};
`,
            // loader needs handler.ts to detect the tool
            'handler.ts': 'placeholder',
          },
        },
      });

      try {
        const repo = await loadRepo({localPath: customRepoDir});

        // Swap handler path to .mjs for dynamic import
        const mjsPath = join(customRepoDir, 'tools', 'risk_scorer', 'handler.mjs');
        for (const tool of repo.tools) {
          if (tool.name === 'risk_scorer') {
            tool.handlerPath = mjsPath;
          }
        }

        const {setupSession, PlanModeManager, prepareExploreConfig} = await import('@amodalai/core');
        const {runAgentTurn} = await import('../agent/agent-runner.js');

        const runtime = setupSession({
          repo,
          userId: 'test',
          userRoles: [],
          isDelegated: false,
        });

        const session = {
          id: 'custom-tool-int-session',
          runtime,
          appId: 'int-test',
          conversationHistory: [],
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          planModeManager: new PlanModeManager(),
          exploreConfig: prepareExploreConfig(runtime),
        };

        // LLM calls risk_scorer tool
        mockChat
          .mockResolvedValueOnce({
            content: [{
              type: 'tool_use',
              id: 'tc_risk_001',
              name: 'risk_scorer',
              input: {deal_id: 'deal_42', revenue: 250000, days_stale: 5},
            }],
            stopReason: 'tool_use',
            usage: {inputTokens: 100, outputTokens: 60},
          })
          .mockResolvedValueOnce({
            content: [{type: 'text', text: 'Deal deal_42 scored as healthy.'}],
            stopReason: 'end_turn',
            usage: {inputTokens: 200, outputTokens: 20},
          });

        const events = await collectEvents(
          runAgentTurn(
            session as Parameters<typeof runAgentTurn>[0],
            'Score deal_42',
            AbortSignal.timeout(30000),
          ),
        );

        // Verify tool call start
        const toolStarts = events.filter((e) => e.type === SSEEventType.ToolCallStart);
        expect(toolStarts).toHaveLength(1);
        if (toolStarts[0].type === SSEEventType.ToolCallStart) {
          expect(toolStarts[0].tool_name).toBe('risk_scorer');
        }

        // Verify tool result
        const toolResults = events.filter((e) => e.type === SSEEventType.ToolCallResult);
        expect(toolResults).toHaveLength(1);

        if (toolResults[0].type === SSEEventType.ToolCallResult) {
          expect(toolResults[0].status).toBe('success');
          const result = JSON.parse(toolResults[0].result ?? '{}') as Record<string, unknown>;

          // The custom tool result is JSON-stringified by executeCustomTool, so it's nested
          const parsed = typeof result['output'] === 'string'
            ? JSON.parse(result['output']) as Record<string, unknown>
            : result;

          // Find the actual payload — may be at top level or wrapped
          const payload = parsed['deal_id'] ? parsed : (parsed['output'] ? JSON.parse(parsed['output'] as string) as Record<string, unknown> : parsed);

          expect(payload['deal_id']).toBe('deal_42');
          expect(payload['risk_score']).toBe('healthy');
          expect(payload['factors']).toEqual({days_stale: 5, revenue: 250000});
        }

        // Verify text response and done event
        const textEvents = events.filter((e) => e.type === SSEEventType.TextDelta);
        expect(textEvents.length).toBeGreaterThan(0);
        expect(events[events.length - 1].type).toBe(SSEEventType.Done);
      } finally {
        rmSync(customRepoDir, {recursive: true, force: true});
      }
    }, 30000);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Connection request tool → verify API call with auth headers
  // ────────────────────────────────────────────────────────────────────────

  describe('5. Connection request tool → auth headers', () => {
    let mockServer: Server;
    let mockPort: number;
    let capturedHeaders: Record<string, string | string[] | undefined>;
    let capturedPath: string;
    let capturedMethod: string;

    beforeAll(async () => {
      // Start a local HTTP server that captures request details
      await new Promise<void>((resolve) => {
        mockServer = createServer((req, res) => {
          capturedHeaders = req.headers;
          capturedPath = req.url ?? '';
          capturedMethod = req.method ?? '';
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({deals: [{id: 'deal_1', name: 'Acme Corp'}]}));
        });
        mockServer.listen(0, '127.0.0.1', () => {
          const addr = mockServer.address();
          if (addr && typeof addr === 'object') {
            mockPort = addr.port;
          }
          resolve();
        });
      });
    });

    afterAll(() => {
      mockServer.close();
    });

    it('makes an HTTP request through a connection with correct auth headers', async () => {
      const connRepoDir = createFixtureRepo();

      try {
        const repo = await loadRepo({localPath: connRepoDir});
        const {setupSession, PlanModeManager, prepareExploreConfig} = await import('@amodalai/core');
        const {runAgentTurn} = await import('../agent/agent-runner.js');

        const runtime = setupSession({
          repo,
          userId: 'test',
          userRoles: [],
          isDelegated: false,
        });

        // Set up connection with auth headers pointing to our mock server
        const connectionsMap = {
          crm: {
            base_url: `http://127.0.0.1:${mockPort}`,
            _request_config: {
              auth: [
                {header: 'Authorization', value_template: 'Bearer test-api-token-123'},
                {header: 'X-Custom-Header', value_template: 'custom-value'},
              ],
            },
          },
        };

        const session = {
          id: 'conn-int-session',
          runtime: {...runtime, connectionsMap},
          appId: 'int-test',
          conversationHistory: [],
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          planModeManager: new PlanModeManager(),
          exploreConfig: prepareExploreConfig(runtime),
        };

        // LLM calls request tool
        mockChat
          .mockResolvedValueOnce({
            content: [{
              type: 'tool_use',
              id: 'tc_req_001',
              name: 'request',
              input: {
                connection: 'crm',
                method: 'GET',
                endpoint: '/api/deals',
                intent: 'read',
                params: {status: 'active'},
              },
            }],
            stopReason: 'tool_use',
            usage: {inputTokens: 100, outputTokens: 60},
          })
          .mockResolvedValueOnce({
            content: [{type: 'text', text: 'Found 1 deal.'}],
            stopReason: 'end_turn',
            usage: {inputTokens: 200, outputTokens: 15},
          });

        const events = await collectEvents(
          runAgentTurn(
            session as Parameters<typeof runAgentTurn>[0],
            'List active deals from CRM',
            AbortSignal.timeout(30000),
          ),
        );

        // Verify tool execution
        const toolStarts = events.filter((e) => e.type === SSEEventType.ToolCallStart);
        expect(toolStarts).toHaveLength(1);
        if (toolStarts[0].type === SSEEventType.ToolCallStart) {
          expect(toolStarts[0].tool_name).toBe('request');
        }

        const toolResults = events.filter((e) => e.type === SSEEventType.ToolCallResult);
        expect(toolResults).toHaveLength(1);
        if (toolResults[0].type === SSEEventType.ToolCallResult) {
          expect(toolResults[0].status).toBe('success');
          const result = JSON.parse(toolResults[0].result ?? '{}') as Record<string, unknown>;
          const deals = result['deals'] as Array<Record<string, unknown>>;
          expect(deals).toHaveLength(1);
          expect(deals[0]['id']).toBe('deal_1');
        }

        // Verify the mock server received correct auth headers
        expect(capturedMethod).toBe('GET');
        expect(capturedPath).toBe('/api/deals?status=active');
        expect(capturedHeaders['authorization']).toBe('Bearer test-api-token-123');
        expect(capturedHeaders['x-custom-header']).toBe('custom-value');
        expect(capturedHeaders['content-type']).toBe('application/json');

        // Verify text + done
        expect(events[events.length - 1].type).toBe(SSEEventType.Done);
      } finally {
        rmSync(connRepoDir, {recursive: true, force: true});
      }
    }, 30000);
  });
});
