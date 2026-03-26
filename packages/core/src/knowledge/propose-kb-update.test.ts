/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProposeKBUpdateTool } from './propose-kb-update.js';
import { PROPOSE_KNOWLEDGE_TOOL_NAME } from '../tools/amodal-tool-names.js';
import type { Config } from '@google/gemini-cli-core';
import type { MessageBus } from '@google/gemini-cli-core';
import type { ProposeKBUpdateParams } from './propose-kb-update.js';

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): Config {
  const get = (key: string, fallback: unknown): unknown =>
    key in overrides ? overrides[key] : fallback;

  return {
    getPlatformApiUrl: vi.fn().mockReturnValue(
      get('platformApiUrl', 'https://platform.example.com'),
    ),
    getPlatformApiKey: vi.fn().mockReturnValue(
      get('platformApiKey', 'sk-test-key'),
    ),
    getApplicationId: vi.fn().mockReturnValue(get('applicationId', 'app-123')),
    getTenantId: vi.fn().mockReturnValue(get('tenantId', 'ten-456')),
    getSessionId: vi.fn().mockReturnValue(get('sessionId', 'sess-789')),
    getAuditLogger: vi.fn().mockReturnValue(
      get('auditLogger', { logKbProposal: vi.fn() }),
    ),
  } as unknown as Config;
}

function makeMessageBus(): MessageBus {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
  } as unknown as MessageBus;
}

function makeParams(overrides: Partial<ProposeKBUpdateParams> = {}): ProposeKBUpdateParams {
  return {
    action: 'create',
    scope: 'application',
    title: 'Rogue sensor detection patterns',
    category: 'patterns',
    body: 'Raspberry Pis appearing without entry trajectories indicates rogue sensor deployment.',
    reasoning: 'Discovered during investigation of Zone C anomaly.',
    ...overrides,
  };
}

describe('ProposeKBUpdateTool', () => {
  let config: Config;
  let messageBus: MessageBus;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    config = makeConfig();
    messageBus = makeMessageBus();
  });

  it('has correct tool name', () => {
    const tool = new ProposeKBUpdateTool(config, messageBus);
    expect(ProposeKBUpdateTool.Name).toBe(PROPOSE_KNOWLEDGE_TOOL_NAME);
    expect(tool.name).toBe(PROPOSE_KNOWLEDGE_TOOL_NAME);
  });

  it('definition schema has correct required fields', () => {
    const tool = new ProposeKBUpdateTool(config, messageBus);
    const schema = tool.getSchema();
    const paramsSchema = schema.parametersJsonSchema as Record<string, unknown>;
    const required = paramsSchema['required'] as string[];
    expect(required).toEqual(
      expect.arrayContaining([
        'action', 'scope', 'title', 'category', 'body', 'reasoning',
      ]),
    );
  });

  it('createInvocation returns ProposeKBUpdateInvocation instance', () => {
    const tool = new ProposeKBUpdateTool(config, messageBus);
    const params = makeParams();
    const invocation = tool.build(params);
    expect(invocation).toBeDefined();
  });
});

describe('ProposeKBUpdateInvocation', () => {
  let config: Config;
  let messageBus: MessageBus;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    config = makeConfig();
    messageBus = makeMessageBus();
  });

  function createInvocation(params: ProposeKBUpdateParams, cfg?: Config) {
    const tool = new ProposeKBUpdateTool(cfg ?? config, messageBus);
    return tool.build(params);
  }

  it('getDescription returns formatted scope + title', () => {
    const invocation = createInvocation(makeParams());
    expect(invocation.getDescription()).toBe(
      'propose_kb_update [application]: Rogue sensor detection patterns',
    );
  });

  it('getDescription shows tenant scope', () => {
    const invocation = createInvocation(makeParams({ scope: 'tenant' }));
    expect(invocation.getDescription()).toBe(
      'propose_kb_update [tenant]: Rogue sensor detection patterns',
    );
  });

  it('execute() with valid org-scope proposal succeeds', async () => {
    const mockResponse = { id: 'prop-001', status: 'pending' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const invocation = createInvocation(makeParams({ scope: 'application' }));
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('prop-001');
    expect(result.llmContent).toContain('pending admin review');
  });

  it('execute() with valid tenant-scope proposal succeeds', async () => {
    const mockResponse = { id: 'prop-002', status: 'pending' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const invocation = createInvocation(makeParams({ scope: 'tenant' }));
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('prop-002');
  });

  it('execute() returns error when platformApiUrl not configured', async () => {
    const cfg = makeConfig({ platformApiUrl: undefined });
    const invocation = createInvocation(makeParams(), cfg);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('Platform API credentials not configured');
  });

  it('execute() returns error when platformApiKey not configured', async () => {
    const cfg = makeConfig({ platformApiKey: undefined });
    const invocation = createInvocation(makeParams(), cfg);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('Platform API credentials not configured');
  });

  it('execute() returns error when applicationId missing for application-scope proposal', async () => {
    const cfg = makeConfig({ applicationId: undefined });
    const invocation = createInvocation(makeParams({ scope: 'application' }), cfg);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('Application ID not configured');
  });

  it('execute() returns error when tenantId missing for tenant-scope proposal', async () => {
    const cfg = makeConfig({ tenantId: undefined });
    const invocation = createInvocation(makeParams({ scope: 'tenant' }), cfg);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('Tenant ID not configured');
  });

  it('execute() returns error for update action without document_id', async () => {
    const invocation = createInvocation(
      makeParams({ action: 'update', document_id: undefined }),
    );
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('document_id is required');
  });

  it('execute() handles HTTP 401 from platform API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    );

    const invocation = createInvocation(makeParams());
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('401');
  });

  it('execute() handles HTTP 500 from platform API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    const invocation = createInvocation(makeParams());
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('500');
  });

  it('execute() handles network errors gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network failure'),
    );

    const invocation = createInvocation(makeParams());
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('Network failure');
  });

  it('execute() sends correct Authorization Bearer header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'prop-003', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const invocation = createInvocation(makeParams());
    await invocation.execute(new AbortController().signal);

    const callArgs = fetchSpy.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-key');
  });

  it('execute() sends correct request body with scope_type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'prop-004', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const params = makeParams({ scope: 'application' });
    const invocation = createInvocation(params);
    await invocation.execute(new AbortController().signal);

    const callArgs = fetchSpy.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    const body = JSON.parse(options.body as string) as Record<string, unknown>;

    // scope_type is sent directly as 'application'
    expect(body['scope_type']).toBe('application');
    expect(body['scope_id']).toBe('app-123');
    expect(body['session_id']).toBe('sess-789');
    expect(body['proposed_title']).toBe('Rogue sensor detection patterns');
    expect(body['proposed_category']).toBe('patterns');
    expect(body['proposed_body']).toContain('Raspberry Pis');
    expect(body['reasoning']).toContain('Zone C');
  });

  it('execute() sends tenant scope_type in request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'prop-004b', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const params = makeParams({ scope: 'tenant' });
    const invocation = createInvocation(params);
    await invocation.execute(new AbortController().signal);

    const callArgs = fetchSpy.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    const body = JSON.parse(options.body as string) as Record<string, unknown>;

    expect(body['scope_type']).toBe('tenant');
    expect(body['scope_id']).toBe('ten-456');
  });

  it('execute() includes session_id from Config', async () => {
    const cfg = makeConfig({ sessionId: 'custom-session-42' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'prop-005', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const invocation = createInvocation(makeParams(), cfg);
    await invocation.execute(new AbortController().signal);

    const callArgs = fetchSpy.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body['session_id']).toBe('custom-session-42');
  });

  it('execute() includes document_id for update actions', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'prop-006', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const params = makeParams({
      action: 'update',
      document_id: 'doc-existing-123',
    });
    const invocation = createInvocation(params);
    await invocation.execute(new AbortController().signal);

    const callArgs = fetchSpy.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body['document_id']).toBe('doc-existing-123');
  });

  it('audit event emitted on successful proposal', async () => {
    const mockLogKbProposal = vi.fn();
    const cfg = makeConfig({
      auditLogger: { logKbProposal: mockLogKbProposal },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'prop-007', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const invocation = createInvocation(makeParams(), cfg);
    await invocation.execute(new AbortController().signal);

    expect(mockLogKbProposal).toHaveBeenCalledWith(
      'application',
      'Rogue sensor detection patterns',
      'prop-007',
    );
  });

  it('audit event NOT emitted on failure', async () => {
    const mockLogKbProposal = vi.fn();
    const cfg = makeConfig({
      auditLogger: { logKbProposal: mockLogKbProposal },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Server Error', { status: 500, statusText: 'Server Error' }),
    );

    const invocation = createInvocation(makeParams(), cfg);
    await invocation.execute(new AbortController().signal);

    expect(mockLogKbProposal).not.toHaveBeenCalled();
  });

  it('execute() POSTs to correct URL', async () => {
    const cfg = makeConfig({ platformApiUrl: 'https://custom-platform.io' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'prop-008', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const invocation = createInvocation(makeParams(), cfg);
    await invocation.execute(new AbortController().signal);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://custom-platform.io/api/proposed-updates',
    );
  });
});
