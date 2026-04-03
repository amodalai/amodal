/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { SSEEventType } from './types.js';

// Mock core module
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockShutdownAudit = vi.fn().mockResolvedValue(undefined);
const mockGetGeminiClient = vi.fn();
const mockGetMessageBus = vi.fn().mockReturnValue({
  on: vi.fn(),
  removeListener: vi.fn(),
});
const mockGetModel = vi.fn().mockReturnValue('test-model');

vi.mock('@amodalai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@amodalai/core')>();
  return {
    ...actual,
    AmodalConfig: vi.fn(function (this: Record<string, unknown>) {
      this['initialize'] = mockInitialize;
      this['shutdownAudit'] = mockShutdownAudit;
      this['getGeminiClient'] = mockGetGeminiClient;
      this['getMessageBus'] = mockGetMessageBus;
      this['getModel'] = mockGetModel;
      this['getConnections'] = vi.fn().mockReturnValue({});
      this['getUpstreamConfig'] = vi.fn().mockReturnValue({
        createToolRegistry: vi.fn().mockResolvedValue({
          registerTool: vi.fn(),
          unregisterTool: vi.fn(),
          getFunctionDeclarations: vi.fn().mockReturnValue([]),
        }),
        getToolRegistry: vi.fn().mockReturnValue({
          registerTool: vi.fn(),
          unregisterTool: vi.fn(),
          getFunctionDeclarations: vi.fn().mockReturnValue([]),
        }),
        getAgentRegistry: vi.fn().mockReturnValue({ getAllDefinitions: () => [] }),
        registerSubAgentTools: vi.fn(),
      });
      this['registerTools'] = vi.fn().mockResolvedValue(undefined);
      this['getBundleSubagents'] = vi.fn().mockReturnValue([]);
      this['getDisabledSubagents'] = vi.fn().mockReturnValue([]);
      this['getAppId'] = vi.fn().mockReturnValue('test-app');
      this['initializeAuth'] = vi.fn().mockResolvedValue(undefined);
      this['getModelConfig'] = vi.fn().mockReturnValue(undefined);
      this['setModelConfig'] = vi.fn();
      this['getBasePrompt'] = vi.fn().mockReturnValue(undefined);
      this['getAgentName'] = vi.fn().mockReturnValue('Test Agent');
      this['getAgentDescription'] = vi.fn().mockReturnValue(undefined);
      this['getAgentContext'] = vi.fn().mockReturnValue(undefined);
      this['getStores'] = vi.fn().mockReturnValue([]);
      this['getStoreBackend'] = vi.fn().mockReturnValue(undefined);
      this['setStoreBackend'] = vi.fn();
    }),
    Scheduler: vi.fn(function (this: Record<string, unknown>) {
      this['schedule'] = vi.fn().mockResolvedValue([]);
    }),
    ROOT_SCHEDULER_ID: 'root',
    ApprovalMode: { YOLO: 'yolo' },
    PolicyDecision: { ALLOW: 'allow', ASK_USER: 'ask_user', DENY: 'deny' },
    GeminiEventType: {
      Content: 'content',
      ToolCallRequest: 'tool_call_request',
      Error: 'error',
      AgentExecutionStopped: 'agent_execution_stopped',
    },
    ToolErrorType: {
      STOP_EXECUTION: 'stop_execution',
    },
    PRESENT_TOOL_NAME: 'present',
    ACTIVATE_SKILL_TOOL_NAME: 'activate_skill',
    buildDefaultPrompt: vi.fn().mockReturnValue('Default system prompt'),
    PlanModeManager: vi.fn(function (this: Record<string, unknown>) {
      this['isActive'] = vi.fn().mockReturnValue(false);
    }),
    McpManager: vi.fn(),
    ensureAdminAgent: vi.fn(),
    loadAdminAgent: vi.fn(),
  };
});

const { createServer } = await import('./server.js');

// Helper to create an async generator from events
async function* makeStream(
  events: Array<{ type: string; value?: unknown }>,
): AsyncGenerator<{ type: string; value?: unknown }> {
  for (const event of events) {
    yield event;
  }
}

describe('createServer', () => {
  let serverInstance: Awaited<ReturnType<typeof createServer>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialize.mockResolvedValue(undefined);
    mockShutdownAudit.mockResolvedValue(undefined);
    mockGetMessageBus.mockReturnValue({
      on: vi.fn(),
      removeListener: vi.fn(),
    });

    const mockChat = {
      recordCompletedToolCalls: vi.fn(),
    };

    mockGetGeminiClient.mockReturnValue({
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      sendMessageStream: vi.fn().mockReturnValue(
        makeStream([{ type: 'content', value: 'Hello from server!' }]),
      ),
      getCurrentSequenceModel: vi.fn().mockReturnValue('test-model'),
      getChat: vi.fn().mockReturnValue({ ...mockChat, setSystemInstruction: vi.fn() }),
      setHistory: vi.fn(),
      setTools: vi.fn().mockResolvedValue(undefined),
    });

    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    serverInstance = createServer({
      baseParams: {
        sessionId: 'server-test',
        model: 'test-model',
        cwd: '/tmp',
        targetDir: '/tmp',
        debugMode: false,
      },
      config: {
        port: 0, // Random port
        host: '127.0.0.1',
        sessionTtlMs: 30_000,
        automations: [],
      },
      version: '1.0.0-test',
    });
  });

  afterEach(async () => {
    await serverInstance.stop();
  });

  it('responds to GET /health', async () => {
    const res = await request(serverInstance.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('responds to GET /version', async () => {
    const res = await request(serverInstance.app).get('/version');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1.0.0-test');
  });

  it('responds to POST /chat with SSE (unified with /chat/stream)', async () => {
    const res = await request(serverInstance.app)
      .post('/chat')
      .send({ message: 'hello' });

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data: ');

    const lines = res.text.split('\n\n').filter(Boolean);
    const events = lines.map((line) =>
      JSON.parse(line.replace('data: ', '')),
    );
    const types = events.map((e: Record<string, unknown>) => e['type']);
    expect(types).toContain(SSEEventType.Init);
    expect(types).toContain(SSEEventType.Done);
  });

  it('responds to POST /chat/stream with SSE', async () => {
    const res = await request(serverInstance.app)
      .post('/chat/stream')
      .send({ message: 'hello' });

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data: ');

    // Parse the SSE events
    const lines = res.text.split('\n\n').filter(Boolean);
    const events = lines.map((line) =>
      JSON.parse(line.replace('data: ', '')),
    );

    // Should have init, text_delta, done events
    const types = events.map((e: Record<string, unknown>) => e['type']);
    expect(types).toContain(SSEEventType.Init);
    expect(types).toContain(SSEEventType.Done);
  });

  it('rejects invalid POST /chat request', async () => {
    const res = await request(serverInstance.app)
      .post('/chat')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown webhook', async () => {
    const res = await request(serverInstance.app)
      .post('/webhooks/nonexistent')
      .send({});

    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent routes', async () => {
    const res = await request(serverInstance.app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});
