/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeAll, afterAll} from 'vitest';
import {createServer, type Server} from 'node:http';
import {createRequestTool, REQUEST_TOOL_NAME} from './request-tool.js';
import type {ConnectionsMap} from './request-tool.js';
import type {PermissionChecker, PermissionResult} from '../security/permission-checker.js';
import {ConnectionError} from '../errors.js';
import type {ToolContext} from './types.js';
import type {LoadedConnection} from '@amodalai/types';
import type {ConnectionSpec} from '@amodalai/core';

// ---------------------------------------------------------------------------
// Mock HTTP server
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    // Echo back request details
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body || undefined,
      }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (typeof addr === 'object' && addr !== null) {
    baseUrl = `http://127.0.0.1:${String(addr.port)}`;
  }
});

afterAll(() => {
  server.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allowAllChecker: PermissionChecker = {
  check: () => ({allowed: true} as PermissionResult),
};

const confirmChecker: PermissionChecker = {
  check: () => ({allowed: true, requiresConfirmation: true, reason: 'Needs confirmation'} as PermissionResult),
};

const denyChecker: PermissionChecker = {
  check: () => ({allowed: false, reason: 'Operation blocked'} as PermissionResult),
};

function makeConnectionsMap(overrides: Partial<ConnectionsMap[string]> = {}): ConnectionsMap {
  return {
    'test-api': {
      base_url: baseUrl,
      API_KEY: 'test-token-123',
      _request_config: {
        base_url_field: 'base_url',
        auth: [{header: 'Authorization', value_template: 'Bearer {{API_KEY}}'}],
        default_headers: {'X-Source': 'amodal'},
      },
      ...overrides,
    },
  };
}

const mockCtx: ToolContext = {
  request: vi.fn(),
  store: vi.fn(),
  env: vi.fn(),
  log: vi.fn(),
  signal: AbortSignal.timeout(5000),
  sessionId: 'test-session',
  scopeId: '',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRequestTool', () => {
  it('has correct name and metadata', () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
    });

    expect(tool.readOnly).toBe(false);
    expect(tool.metadata?.category).toBe('connection');
    expect(REQUEST_TOOL_NAME).toBe('request');
  });

  it('makes a GET request with auth headers', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/users',
      intent: 'read',
    }, mockCtx) as Record<string, unknown>;

    expect(result['status']).toBe(200);
    const data = result['data'] as Record<string, unknown>;
    expect(data['method']).toBe('GET');
    const headers = data['headers'] as Record<string, unknown>;
    expect(headers['authorization']).toBe('Bearer test-token-123');
    expect(headers['x-source']).toBe('amodal');
  });

  it('makes a POST request with body', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'POST',
      endpoint: '/articles',
      intent: 'confirmed_write',
      data: {title: 'Test Article'},
    }, mockCtx) as Record<string, unknown>;

    expect(result['status']).toBe(200);
    const data = result['data'] as Record<string, unknown>;
    expect(data['method']).toBe('POST');
    expect(data['body']).toBe('{"title":"Test Article"}');
  });

  it('returns preview for write intent when confirmation required', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: confirmChecker,
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'POST',
      endpoint: '/articles',
      intent: 'write',
      data: {title: 'Draft'},
    }, mockCtx) as Record<string, unknown>;

    expect(result['preview']).toBe(true);
    expect(result['method']).toBe('POST');
    expect(result['instruction']).toContain('confirmed_write');
  });

  it('returns error when permission denied', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: denyChecker,
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'DELETE',
      endpoint: '/articles/1',
      intent: 'write',
    }, mockCtx) as Record<string, unknown>;

    expect(result['error']).toBe('Operation blocked');
  });

  it('throws ConnectionError for unknown connection', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
    });

    await expect(
      tool.execute({
        connection: 'nonexistent',
        method: 'GET',
        endpoint: '/test',
        intent: 'read',
      }, mockCtx),
    ).rejects.toThrow(ConnectionError);
  });

  it('throws ConnectionError when no base_url', async () => {
    const tool = createRequestTool({
      connectionsMap: {'no-url': {} as ConnectionsMap[string]},
      permissionChecker: allowAllChecker,
    });

    await expect(
      tool.execute({
        connection: 'no-url',
        method: 'GET',
        endpoint: '/test',
        intent: 'read',
      }, mockCtx),
    ).rejects.toThrow(ConnectionError);
  });

  it('expands $ENV_VAR in endpoints', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
      sessionEnv: {APP_ID: 'my-app'},
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/apps/$APP_ID/status',
      intent: 'read',
    }, mockCtx) as Record<string, unknown>;

    const data = result['data'] as Record<string, unknown>;
    expect(data['url']).toBe('/apps/my-app/status');
  });

  it('appends query params', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/search',
      intent: 'read',
      params: {q: 'test', limit: '10'},
    }, mockCtx) as Record<string, unknown>;

    const data = result['data'] as Record<string, unknown>;
    const url = data['url'] as string;
    expect(url).toContain('q=test');
    expect(url).toContain('limit=10');
  });

  it('handles non-string query param values without crashing', async () => {
    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/search',
      intent: 'read',
      params: {per_page: 30, tag: 'ai', active: true} as unknown as Record<string, string>,
    }, mockCtx) as Record<string, unknown>;

    const data = result['data'] as Record<string, unknown>;
    const url = data['url'] as string;
    expect(url).toContain('per_page=30');
    expect(url).toContain('tag=ai');
    expect(url).toContain('active=true');
  });

  // ---------------------------------------------------------------------------
  // Context injection
  // ---------------------------------------------------------------------------

  /** Build a typed loadedConnections map with only contextInjection set. */
  function makeLoadedConnections(
    injection: NonNullable<ConnectionSpec['contextInjection']>,
  ): Map<string, Pick<LoadedConnection, 'spec'>> {
    return new Map([
      ['test-api', {spec: {protocol: 'rest', contextInjection: injection} as ConnectionSpec}],
    ]);
  }

  it('injects header from scopeContext via contextInjection', async () => {
    const loadedConnections = makeLoadedConnections({tenant_id: {in: 'header', field: 'X-Tenant-Id', required: true}});

    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
      loadedConnections,
      scopeContext: {tenant_id: 'abc-123'},
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/data',
      intent: 'read',
    }, mockCtx) as Record<string, unknown>;

    expect(result['status']).toBe(200);
    const data = result['data'] as Record<string, unknown>;
    const headers = data['headers'] as Record<string, unknown>;
    expect(headers['x-tenant-id']).toBe('abc-123');
  });

  it('injects query param from scopeContext via contextInjection', async () => {
    const loadedConnections = makeLoadedConnections({org_id: {in: 'query', field: 'org_id'}});

    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
      loadedConnections,
      scopeContext: {org_id: 'org-456'},
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/items',
      intent: 'read',
    }, mockCtx) as Record<string, unknown>;

    const data = result['data'] as Record<string, unknown>;
    expect(data['url']).toContain('org_id=org-456');
  });

  it('throws when required context injection key is missing', async () => {
    const loadedConnections = makeLoadedConnections({tenant_id: {in: 'header', field: 'X-Tenant-Id', required: true}});

    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
      loadedConnections,
      scopeContext: {}, // missing tenant_id
    });

    await expect(
      tool.execute({
        connection: 'test-api',
        method: 'GET',
        endpoint: '/data',
        intent: 'read',
      }, mockCtx),
    ).rejects.toThrow(ConnectionError);
  });

  it('skips optional context injection key when missing', async () => {
    const loadedConnections = makeLoadedConnections({tenant_id: {in: 'header', field: 'X-Tenant-Id'}});

    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
      loadedConnections,
      scopeContext: {}, // missing but not required
    });

    const result = await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/data',
      intent: 'read',
    }, mockCtx) as Record<string, unknown>;

    expect(result['status']).toBe(200);
    const data = result['data'] as Record<string, unknown>;
    const headers = data['headers'] as Record<string, unknown>;
    expect(headers['x-tenant-id']).toBeUndefined();
  });

  it('throws when body injection has no request body', async () => {
    const loadedConnections = makeLoadedConnections({tenant_id: {in: 'body', field: 'tenant_id', required: true}});

    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: allowAllChecker,
      loadedConnections,
      scopeContext: {tenant_id: 'abc'},
    });

    await expect(
      tool.execute({
        connection: 'test-api',
        method: 'GET',
        endpoint: '/data',
        intent: 'read',
        // no data — body injection should throw
      }, mockCtx),
    ).rejects.toThrow(ConnectionError);
  });

  // ---------------------------------------------------------------------------
  // Permission checker shape
  // ---------------------------------------------------------------------------

  it('passes permission checker the correct request shape', async () => {
    const checkSpy = vi.fn().mockReturnValue({allowed: true});
    const spyChecker: PermissionChecker = {check: checkSpy};

    const tool = createRequestTool({
      connectionsMap: makeConnectionsMap(),
      permissionChecker: spyChecker,
      readOnly: true,
      planModeActive: () => true,
    });

    await tool.execute({
      connection: 'test-api',
      method: 'GET',
      endpoint: '/data',
      intent: 'read',
    }, mockCtx).catch(() => {/* may fail on fetch, that's ok */});

    expect(checkSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: 'test-api',
        method: 'GET',
        intent: 'read',
        readOnly: true,
        planModeActive: true,
      }),
    );
  });
});
