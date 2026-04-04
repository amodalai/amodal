/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool Context Factory Tests (Phase 3.5a).
 *
 * Covers:
 * 1. ctx.request() — makes HTTP calls through connections with auth headers
 * 2. ctx.request() — connection not found error with suggestion
 * 3. ctx.request() — auth failure → ConnectionError
 * 4. ctx.store() — writes to store backend with key resolution
 * 5. ctx.store() — store not found error
 * 6. ctx.env() — allowlisted vars exposed, others blocked
 * 7. ctx.log() — emits structured log event
 * 8. ctx.user, ctx.sessionId, ctx.tenantId — passthrough
 * 9. Factory returns fresh context per callId
 */

import {describe, it, expect, vi, afterEach} from 'vitest';
import {createToolContextFactory, type ToolContextFactoryOptions} from './tool-context-factory.js';
import type {LoadedStore, StoreBackend} from '@amodalai/types';
import type {ConnectionsMap} from '../tools/request-tool.js';
import {StoreError} from '../errors.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeMockStoreBackend(): StoreBackend {
  return {
    initialize: vi.fn(),
    get: vi.fn(),
    put: vi.fn().mockResolvedValue({stored: true, key: 'resolved-key', version: 1}),
    list: vi.fn(),
    delete: vi.fn(),
    history: vi.fn(),
    purgeExpired: vi.fn(),
    close: vi.fn(),
  };
}

function makeStoreDefinition(overrides?: Partial<LoadedStore>): LoadedStore {
  return {
    name: 'deals',
    entity: {
      name: 'Deal',
      key: '{company}_{quarter}',
      schema: {
        company: {type: 'string'},
        quarter: {type: 'string'},
        amount: {type: 'number'},
      },
    },
    location: '/tmp/stores/deals.json',
    ...overrides,
  };
}

function makeConnectionsMap(): ConnectionsMap {
  return {
    stripe: {
      base_url: 'https://api.stripe.com',
      _request_config: {
        base_url_field: 'base_url',
        auth: [{header: 'Authorization', value_template: 'Bearer {{STRIPE_KEY}}'}],
      },
      STRIPE_KEY: 'sk_test_123',
    },
    slack: {
      base_url: 'https://slack.com/api',
      _request_config: {
        base_url_field: 'base_url',
        auth: [{header: 'Authorization', value_template: 'Bearer {{SLACK_TOKEN}}'}],
        default_headers: {'X-Custom': 'value'},
      },
      SLACK_TOKEN: 'xoxb-test',
    },
  };
}

function makeFactoryOpts(overrides?: Partial<ToolContextFactoryOptions>): ToolContextFactoryOptions {
  return {
    connectionsMap: makeConnectionsMap(),
    storeBackend: makeMockStoreBackend(),
    storeDefinitions: [makeStoreDefinition()],
    appId: 'test-app',
    envAllowlist: {ALLOWED_VAR: 'allowed-value'},
    logger: makeMockLogger(),
    user: {roles: ['analyst']},
    sessionId: 'sess-123',
    tenantId: 'tenant-456',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createToolContextFactory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic factory behavior
  // -------------------------------------------------------------------------

  it('returns a factory function that produces ToolContext', () => {
    const factory = createToolContextFactory(makeFactoryOpts());
    const ctx = factory('call-1');

    expect(ctx.sessionId).toBe('sess-123');
    expect(ctx.tenantId).toBe('tenant-456');
    expect(ctx.user.roles).toEqual(['analyst']);
    expect(ctx.signal).toBeDefined();
    expect(ctx.signal.aborted).toBe(false);
  });

  it('returns fresh context per callId', () => {
    const factory = createToolContextFactory(makeFactoryOpts());
    const ctx1 = factory('call-1');
    const ctx2 = factory('call-2');

    // Different objects
    expect(ctx1).not.toBe(ctx2);
    // Same session info
    expect(ctx1.sessionId).toBe(ctx2.sessionId);
  });

  // -------------------------------------------------------------------------
  // ctx.env()
  // -------------------------------------------------------------------------

  it('env() returns allowlisted vars', () => {
    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');

    expect(ctx.env('ALLOWED_VAR')).toBe('allowed-value');
  });

  it('env() blocks non-allowlisted vars', () => {
    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');

    expect(ctx.env('BLOCKED_VAR')).toBeUndefined();
    expect(ctx.env('HOME')).toBeUndefined();
    expect(ctx.env('PATH')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // ctx.log()
  // -------------------------------------------------------------------------

  it('log() emits structured event via logger', () => {
    const logger = makeMockLogger();
    const ctx = createToolContextFactory(makeFactoryOpts({logger}))('call-42');

    ctx.log('processing item');

    expect(logger.info).toHaveBeenCalledWith('tool_log', {
      callId: 'call-42',
      message: 'processing item',
      session: 'sess-123',
      tenant: 'tenant-456',
    });
  });

  // -------------------------------------------------------------------------
  // ctx.store()
  // -------------------------------------------------------------------------

  it('store() writes to backend with resolved key', async () => {
    const backend = makeMockStoreBackend();
    const ctx = createToolContextFactory(makeFactoryOpts({storeBackend: backend}))('call-1');

    const result = await ctx.store('deals', {company: 'acme', quarter: 'Q1', amount: 5000});

    expect(result).toEqual({key: 'acme_Q1'});
    expect(backend.put).toHaveBeenCalledWith(
      'test-app',
      'deals',
      'acme_Q1',
      {company: 'acme', quarter: 'Q1', amount: 5000},
      {},
    );
  });

  it('store() throws StoreError when store not found', async () => {
    const ctx = createToolContextFactory(makeFactoryOpts({storeDefinitions: []}))('call-1');

    await expect(ctx.store('nonexistent', {})).rejects.toThrow(StoreError);
    await expect(ctx.store('nonexistent', {})).rejects.toThrow(/Store "nonexistent" not found/);
  });

  it('store() throws when key template field is missing', async () => {
    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');

    await expect(ctx.store('deals', {company: 'acme'})).rejects.toThrow(/field "quarter"/);
  });

  it('store() logs write with key and store name', async () => {
    const logger = makeMockLogger();
    const ctx = createToolContextFactory(makeFactoryOpts({logger}))('call-1');

    await ctx.store('deals', {company: 'acme', quarter: 'Q1', amount: 100});

    expect(logger.debug).toHaveBeenCalledWith('tool_context_store_write', expect.objectContaining({
      store: 'deals',
      key: 'acme_Q1',
    }));
  });

  // -------------------------------------------------------------------------
  // ctx.request()
  // -------------------------------------------------------------------------

  it('request() makes HTTP call with auth headers', async () => {
    const mockResponse = new Response(JSON.stringify({data: 'ok'}), {status: 200});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');
    const result = await ctx.request('stripe', '/v1/customers', {method: 'GET'});

    expect(result).toEqual({data: 'ok'});
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/customers',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_123',
        }),
      }),
    );
  });

  it('request() includes default headers from connection config', async () => {
    const mockResponse = new Response(JSON.stringify({ok: true}), {status: 200});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');
    await ctx.request('slack', '/chat.postMessage', {method: 'POST', data: {text: 'hi'}});

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer xoxb-test',
          'X-Custom': 'value',
        }),
        body: JSON.stringify({text: 'hi'}),
      }),
    );
  });

  it('request() adds query params', async () => {
    const mockResponse = new Response(JSON.stringify([]), {status: 200});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');
    await ctx.request('stripe', '/v1/charges', {params: {limit: '10', status: 'paid'}});

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('status=paid');
  });

  it('request() throws ConnectionError when connection not found', async () => {
    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');

    await expect(ctx.request('unknown', '/foo')).rejects.toThrow(/Connection "unknown" not found/);
  });

  it('request() suggests similar connection name', async () => {
    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');

    await expect(ctx.request('Stripe', '/foo')).rejects.toThrow(/Did you mean "stripe"/);
  });

  it('request() throws ConnectionError on auth failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', {status: 401}));

    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');

    await expect(ctx.request('stripe', '/v1/customers')).rejects.toThrow(/Authentication failed/);
  });

  it('request() throws ConnectionError on server error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Server Error', {status: 500}));

    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');

    await expect(ctx.request('stripe', '/v1/customers')).rejects.toThrow(/HTTP 500/);
  });

  it('request() returns raw text when response is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('plain text', {status: 200}));

    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');
    const result = await ctx.request('stripe', '/v1/export');

    expect(result).toBe('plain text');
  });

  it('request() defaults to GET method', async () => {
    const mockResponse = new Response(JSON.stringify({ok: true}), {status: 200});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const ctx = createToolContextFactory(makeFactoryOpts())('call-1');
    await ctx.request('stripe', '/v1/customers');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({method: 'GET'}),
    );
  });

  it('request() logs with connection and endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {status: 200}));
    const logger = makeMockLogger();

    const ctx = createToolContextFactory(makeFactoryOpts({logger}))('call-7');
    await ctx.request('stripe', '/v1/customers', {method: 'GET'});

    expect(logger.debug).toHaveBeenCalledWith('tool_context_request', expect.objectContaining({
      callId: 'call-7',
      connection: 'stripe',
      endpoint: '/v1/customers',
      method: 'GET',
    }));
  });
});
