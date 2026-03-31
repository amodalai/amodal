/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {RequestTool} from '../tools/request-tool.js';
import {ToolErrorType} from '@google/gemini-cli-core';
import type {MessageBus} from '@google/gemini-cli-core';
import type {ConnectionsMap} from '../templates/connections.js';
import type {RequestToolParams, RequestSecurityConfig} from '../tools/request-tool-types.js';
import type {AccessConfig} from '../repo/connection-schemas.js';
import {FieldScrubber} from '../security/field-scrubber.js';
import {ActionGate} from '../security/action-gate.js';
import {ScrubTracker} from '../security/scrub-tracker.js';
import type {SessionRuntime} from './session-setup.js';
import {
  createSecuredRequestTool,
  createSecuredReadOnlyRequestTool,
} from './request-integration.js';

function createMockMessageBus(): MessageBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  } as unknown as MessageBus;  
}

const connections: ConnectionsMap = {
  test_api: {
    BASE_URL: 'https://api.example.com',
    API_KEY: 'test-key',
    _request_config: {
      base_url_field: 'BASE_URL',
      auth: [{header: 'Authorization', value_template: 'Bearer {{API_KEY}}'}],
      default_headers: {Accept: 'application/json'},
    },
  },
};

/**
 * Access config that gates DELETE /api/users as 'never',
 * PUT /api/orders as 'review', and POST /api/items as 'confirm'.
 * Also restricts the 'ssn' field on the 'user' entity.
 */
function buildTestAccessConfig(): AccessConfig {
  return {
    endpoints: {
      'DELETE /api/users': {
        returns: ['user'],
        confirm: 'never',
        reason: 'User deletion is forbidden',
      },
      'PUT /api/orders': {
        returns: ['order'],
        confirm: 'review',
        reason: 'Order updates require review',
      },
      'POST /api/items': {
        returns: ['item'],
        confirm: true,
      },
      'GET /api/users': {
        returns: ['user'],
      },
    },
    fieldRestrictions: [
      {
        entity: 'user',
        field: 'ssn',
        policy: 'never_retrieve',
        sensitivity: 'pii',
        reason: 'SSN is never exposed',
      },
      {
        entity: 'user',
        field: 'phone',
        policy: 'retrieve_but_redact',
        sensitivity: 'pii',
        reason: 'Phone is redacted in output',
      },
    ],
  };
}

function buildSecurityConfig(opts?: {
  planModeActive?: () => boolean;
}): RequestSecurityConfig {
  const accessConfigs = new Map<string, AccessConfig>();
  accessConfigs.set('test_api', buildTestAccessConfig());

  const tracker = new ScrubTracker();
  const fieldScrubber = new FieldScrubber({
    accessConfigs,
    userRoles: [],
    tracker,
  });
  const actionGate = new ActionGate({
    accessConfigs,
    isDelegated: false,
  });

  return {
    fieldScrubber,
    actionGate,
    planModeActive: opts?.planModeActive,
  };
}

function buildAndExecute(
  params: RequestToolParams,
  security?: RequestSecurityConfig,
  readOnly = false,
) {
  const messageBus = createMockMessageBus();
  const tool = new RequestTool(connections, messageBus, readOnly, {}, security);
  const invocation = tool.build(params);
  return invocation.execute(new AbortController().signal);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

describe('RequestTool security integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
     
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('plan mode', () => {
    it('blocks write when plan mode is active', async () => {
      const security = buildSecurityConfig({planModeActive: () => true});
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'POST',
          endpoint: '/api/items',
          intent: 'write',
        },
        security,
      );
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('Plan mode is active');
    });

    it('blocks confirmed_write when plan mode is active', async () => {
      const security = buildSecurityConfig({planModeActive: () => true});
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'POST',
          endpoint: '/api/items',
          intent: 'confirmed_write',
        },
        security,
      );
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('Plan mode is active');
    });

    it('allows read when plan mode is active', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ok: true}));
      const security = buildSecurityConfig({planModeActive: () => true});
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'GET',
          endpoint: '/api/users',
          intent: 'read',
        },
        security,
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('HTTP 200');
    });

    it('allows write when plan mode is not active', async () => {
      const security = buildSecurityConfig({planModeActive: () => false});
      // intent=write returns preview (doesn't actually fetch)
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'POST',
          endpoint: '/api/items',
          intent: 'write',
        },
        security,
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('WRITE PREVIEW');
    });
  });

  describe('action gate', () => {
    it('blocks write when gate decision is never', async () => {
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'DELETE',
          endpoint: '/api/users',
          intent: 'write',
        },
        security,
      );
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.llmContent).toContain('Action blocked');
      expect(result.llmContent).toContain('User deletion is forbidden');
    });

    it('blocks confirmed_write when gate decision is never', async () => {
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'DELETE',
          endpoint: '/api/users',
          intent: 'confirmed_write',
        },
        security,
      );
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.llmContent).toContain('Action blocked');
    });

    it('returns review message when gate decision is review', async () => {
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'PUT',
          endpoint: '/api/orders',
          intent: 'write',
        },
        security,
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('requires human review');
      expect(result.llmContent).toContain('Order updates require review');
      expect(result.returnDisplay).toContain('Review required');
    });

    it('proceeds with write preview when gate decision is confirm', async () => {
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'POST',
          endpoint: '/api/items',
          intent: 'write',
        },
        security,
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('WRITE PREVIEW');
    });

    it('proceeds when gate decision is allow (unknown endpoint)', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({created: true}));
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'POST',
          endpoint: '/api/unknown',
          intent: 'confirmed_write',
        },
        security,
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('HTTP 200');
    });

    it('does not gate read requests', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({users: []}));
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'GET',
          endpoint: '/api/users',
          intent: 'read',
        },
        security,
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('HTTP 200');
    });
  });

  describe('field scrubbing', () => {
    it('strips never_retrieve fields from read responses', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          users: [{id: 1, name: 'Alice', ssn: '123-45-6789', phone: '555-1234'}],
        }),
      );
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'GET',
          endpoint: '/api/users',
          intent: 'read',
        },
        security,
      );
      expect(result.llmContent).toContain('Alice');
      expect(result.llmContent).not.toContain('123-45-6789');
    });

    it('keeps retrieve_but_redact fields in response data', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          users: [{id: 1, name: 'Alice', phone: '555-1234'}],
        }),
      );
      const security = buildSecurityConfig();
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'GET',
          endpoint: '/api/users',
          intent: 'read',
        },
        security,
      );
      // retrieve_but_redact fields are kept (redaction happens in output guard)
      expect(result.llmContent).toContain('555-1234');
    });

    it('records scrubbed fields to tracker', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          users: [{id: 1, name: 'Alice', ssn: '123-45-6789'}],
        }),
      );
      const security = buildSecurityConfig();
      // Access the tracker to verify records
      const tracker = security.fieldScrubber!.scrub(
        {users: [{ssn: '999'}]},
        'GET /api/users',
        'test_api',
      );
      expect(tracker.strippedCount).toBe(1);
    });
  });

  describe('backwards compatibility', () => {
    it('passes through without security config', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({users: [{id: 1, ssn: '123-45-6789'}]}),
      );
      const result = await buildAndExecute({
        connection: 'test_api',
        method: 'GET',
        endpoint: '/api/users',
        intent: 'read',
      });
      // No scrubbing — SSN is present
      expect(result.llmContent).toContain('123-45-6789');
    });

    it('write preview works without security config', async () => {
      const result = await buildAndExecute({
        connection: 'test_api',
        method: 'POST',
        endpoint: '/api/items',
        intent: 'write',
        data: {name: 'widget'},
      });
      expect(result.llmContent).toContain('WRITE PREVIEW');
    });

    it('read-only still blocks writes without security config', async () => {
      const result = await buildAndExecute(
        {
          connection: 'test_api',
          method: 'POST',
          endpoint: '/api/items',
          intent: 'write',
        },
        undefined,
        true,
      );
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('Task agents');
    });
  });

  describe('asReadOnly', () => {
    it('preserves security config on asReadOnly', async () => {
      const messageBus = createMockMessageBus();
      const security = buildSecurityConfig({planModeActive: () => true});
      const tool = new RequestTool(connections, messageBus, false, {}, security);
      const readOnlyTool = tool.asReadOnly();

      const invocation = readOnlyTool.build({
        connection: 'test_api',
        method: 'POST',
        endpoint: '/api/items',
        intent: 'write',
      });
      const result = await invocation.execute(new AbortController().signal);

      // readOnly check fires first
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('Task agents');
    });

    it('returns self when already read-only', () => {
      const messageBus = createMockMessageBus();
      const security = buildSecurityConfig();
      const tool = new RequestTool(connections, messageBus, true, {}, security);
      const same = tool.asReadOnly();
      expect(same).toBe(tool);
    });
  });
});

describe('createSecuredRequestTool', () => {
  it('returns a configured RequestTool', () => {
    const messageBus = createMockMessageBus();
    const runtime = buildMockRuntime();
    const tool = createSecuredRequestTool(runtime, messageBus);
    expect(tool).toBeInstanceOf(RequestTool);
    expect(tool.name).toBe('request');
  });

  it('tool is not read-only', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ok: true}));
     
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    try {
      const messageBus = createMockMessageBus();
      const runtime = buildMockRuntime();
      const tool = createSecuredRequestTool(runtime, messageBus);
      const invocation = tool.build({
        connection: 'test_api',
        method: 'POST',
        endpoint: '/api/unknown',
        intent: 'confirmed_write',
      });
      const result = await invocation.execute(new AbortController().signal);
      // Not blocked by readOnly — should proceed to HTTP (allow decision for unknown endpoint)
      expect(result.llmContent).toContain('HTTP 200');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('createSecuredReadOnlyRequestTool', () => {
  it('returns a read-only RequestTool', async () => {
    const messageBus = createMockMessageBus();
    const runtime = buildMockRuntime();
    const tool = createSecuredReadOnlyRequestTool(runtime, messageBus);
    expect(tool).toBeInstanceOf(RequestTool);

    const invocation = tool.build({
      connection: 'test_api',
      method: 'POST',
      endpoint: '/api/items',
      intent: 'write',
    });
    const result = await invocation.execute(new AbortController().signal);
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.llmContent).toContain('Task agents');
  });
});

describe('session env isolation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('expandEnvVars resolves from sessionEnv, not process.env', async () => {
    // Put a value on process.env that should NOT be used
    process.env['TEST_ISOLATION_VAR'] = 'leaked-from-process-env';

    const sessionEnv = { TEST_ISOLATION_VAR: 'correct-session-value' };
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
     
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const messageBus = createMockMessageBus();
    const tool = new RequestTool(connections, messageBus, false, sessionEnv);
    const invocation = tool.build({
      connection: 'test_api',
      method: 'GET',
      endpoint: '/api/items/$TEST_ISOLATION_VAR',
      intent: 'read',
    });
    await invocation.execute(new AbortController().signal);

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('correct-session-value');
    expect(calledUrl).not.toContain('leaked-from-process-env');

    delete process.env['TEST_ISOLATION_VAR'];
  });

  it('two sessions with different secrets resolve different values', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
     
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const messageBus = createMockMessageBus();

    // Session A — app A's secret
    const toolA = new RequestTool(connections, messageBus, false, { TENANT_KEY: 'secret-A' });
    const invA = toolA.build({
      connection: 'test_api',
      method: 'GET',
      endpoint: '/api/items/$TENANT_KEY',
      intent: 'read',
    });
    await invA.execute(new AbortController().signal);

    // Session B — app B's secret
    const toolB = new RequestTool(connections, messageBus, false, { TENANT_KEY: 'secret-B' });
    const invB = toolB.build({
      connection: 'test_api',
      method: 'GET',
      endpoint: '/api/items/$TENANT_KEY',
      intent: 'read',
    });
    await invB.execute(new AbortController().signal);

    const urlA = mockFetch.mock.calls[0]?.[0] as string;
    const urlB = mockFetch.mock.calls[1]?.[0] as string;
    expect(urlA).toContain('secret-A');
    expect(urlB).toContain('secret-B');
    expect(urlA).not.toContain('secret-B');
    expect(urlB).not.toContain('secret-A');
  });

  it('empty sessionEnv leaves $VAR unexpanded', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
     
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const messageBus = createMockMessageBus();
    const tool = new RequestTool(connections, messageBus, false, {});
    const invocation = tool.build({
      connection: 'test_api',
      method: 'GET',
      endpoint: '/api/items/$UNKNOWN_VAR',
      intent: 'read',
    });
    await invocation.execute(new AbortController().signal);

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('$UNKNOWN_VAR');
  });

  it('createSecuredRequestTool extracts sessionEnv from _secrets', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
     
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const runtimeWithSecrets = buildMockRuntime();
    // Inject _secrets into the connections map
     
    (runtimeWithSecrets.connectionsMap as Record<string, unknown>)['_secrets'] = {
      MY_SECRET: 'from-secrets-map',
    };

    const messageBus = createMockMessageBus();
    const tool = createSecuredRequestTool(runtimeWithSecrets, messageBus);
    const invocation = tool.build({
      connection: 'test_api',
      method: 'GET',
      endpoint: '/api/items/$MY_SECRET',
      intent: 'read',
    });
    await invocation.execute(new AbortController().signal);

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('from-secrets-map');
  });
});

function buildMockRuntime(): SessionRuntime {
  const accessConfigs = new Map<string, AccessConfig>();
  accessConfigs.set('test_api', buildTestAccessConfig());

  const tracker = new ScrubTracker();
  const fieldScrubber = new FieldScrubber({
    accessConfigs,
    userRoles: [],
    tracker,
  });
  const actionGate = new ActionGate({
    accessConfigs,
    isDelegated: false,
  });

   
  return {
    connectionsMap: connections,
    fieldScrubber,
    actionGate,
    userRoles: [],
    sessionId: 'test-session',
    isDelegated: false,
  } as unknown as SessionRuntime;
}
