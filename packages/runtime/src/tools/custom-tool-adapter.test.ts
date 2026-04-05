/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCustomToolDefinition } from './custom-tool-adapter.js';
import type { CustomToolSessionContext } from './custom-tool-adapter.js';
import type { LoadedTool, CustomToolExecutor } from '@amodalai/types';
import type { ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTool(overrides?: Partial<LoadedTool>): LoadedTool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
    confirm: true,
    timeout: 30_000,
    env: ['TEST_KEY'],
    handlerPath: '/fake/handler.ts',
    location: '/fake',
    hasPackageJson: false,
    hasSetupScript: false,
    hasRequirementsTxt: false,
    hasDockerfile: false,
    sandboxLanguage: 'node',
    ...overrides,
  };
}

function makeExecutor(result: unknown = { ok: true }): CustomToolExecutor {
  return {
    execute: vi.fn().mockResolvedValue(result),
  };
}

function makeSessionCtx(overrides?: Partial<CustomToolSessionContext>): CustomToolSessionContext {
  return {
    config: {
      getConnections: () => ({
        typefully: {
          base_url: 'https://api.typefully.com',
          _request_config: {
            auth: [{ header: 'Authorization', value_template: 'Bearer tok-123' }],
            default_headers: { 'X-Custom': 'yes' },
          },
        },
      }),
      getStores: () => [{
        name: 'alerts',
        entity: { key: '{alert_id}', schema: { alert_id: { type: 'string' } } },
      }],
    },
    storeBackend: {
      put: vi.fn().mockResolvedValue(undefined),
    },
    appId: 'test-app',
    ...overrides,
  };
}

function makeToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    request: vi.fn(),
    store: vi.fn(),
    env: vi.fn(),
    log: vi.fn(),
    user: { roles: ['admin'] },
    signal: AbortSignal.timeout(30_000),
    sessionId: 'sess-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCustomToolDefinition', () => {
  describe('schema', () => {
    it('passes JSON Schema through to ToolDefinition parameters', () => {
      const tool = makeTool();
      const def = createCustomToolDefinition(tool, makeExecutor(), makeSessionCtx());

      expect(def.description).toBe('A test tool');
      // The jsonSchema() wrapper preserves the original schema
      expect(def.parameters).toBeDefined();
    });

    it('sets readOnly: true when confirm is false', () => {
      const def = createCustomToolDefinition(
        makeTool({ confirm: false }),
        makeExecutor(),
        makeSessionCtx(),
      );
      expect(def.readOnly).toBe(true);
    });

    it('sets readOnly: false when confirm is true', () => {
      const def = createCustomToolDefinition(
        makeTool({ confirm: true }),
        makeExecutor(),
        makeSessionCtx(),
      );
      expect(def.readOnly).toBe(false);
    });

    it('sets metadata.category to custom', () => {
      const def = createCustomToolDefinition(makeTool(), makeExecutor(), makeSessionCtx());
      expect(def.metadata?.category).toBe('custom');
    });
  });

  describe('execute', () => {
    it('calls executor with tool, params, and context', async () => {
      const executor = makeExecutor({ result: 42 });
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());
      const ctx = makeToolContext();

      const result = await def.execute({ query: 'test' }, ctx);

      expect(executor.execute).toHaveBeenCalledOnce();
      expect(result).toEqual({ result: 42 });
    });

    it('wraps executor errors in ToolExecutionError', async () => {
      const executor: CustomToolExecutor = {
        execute: vi.fn().mockRejectedValue(new Error('handler crashed')),
      };
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());

      await expect(def.execute({ query: 'test' }, makeToolContext()))
        .rejects.toThrow('Tool "test_tool" failed: handler crashed');
    });

    it('wraps AbortError as abort-specific message', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      const executor: CustomToolExecutor = {
        execute: vi.fn().mockRejectedValue(abortErr),
      };
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());

      await expect(def.execute({ query: 'test' }, makeToolContext()))
        .rejects.toThrow('Tool "test_tool" was aborted');
    });
  });

  describe('ctx.request()', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"data": "ok"}'),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('applies auth headers from connection config', async () => {
      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) => {
          const result = await (ctx as { request: (c: string, e: string) => Promise<unknown> }).request('typefully', '/social-sets');
          return result;
        }),
      };
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());
      await def.execute({}, makeToolContext());

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.typefully.com/social-sets');
      expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
      expect((opts.headers as Record<string, string>)['X-Custom']).toBe('yes');
    });

    it('throws on unknown connection', async () => {
      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) => {
          await (ctx as { request: (c: string, e: string) => Promise<unknown> }).request('nonexistent', '/foo');
        }),
      };
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());

      await expect(def.execute({}, makeToolContext()))
        .rejects.toThrow('Connection "nonexistent" not found');
    });

    it('rejects non-GET when confirm is false', async () => {
      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) => {
          await (ctx as { request: (c: string, e: string, p: { method: string }) => Promise<unknown> })
            .request('typefully', '/post', { method: 'POST' });
        }),
      };
      const def = createCustomToolDefinition(
        makeTool({ confirm: false }),
        executor,
        makeSessionCtx(),
      );

      await expect(def.execute({}, makeToolContext()))
        .rejects.toThrow('only GET requests are allowed');
    });

    it('throws on non-2xx responses', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) => {
          await (ctx as { request: (c: string, e: string) => Promise<unknown> }).request('typefully', '/social-sets');
        }),
      };
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());

      await expect(def.execute({}, makeToolContext()))
        .rejects.toThrow('returned 401');
    });
  });

  describe('ctx.store()', () => {
    it('writes to store backend with resolved key', async () => {
      const sessionCtx = makeSessionCtx();
      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) =>
          (ctx as { store: (n: string, p: Record<string, unknown>) => Promise<unknown> })
            .store('alerts', { alert_id: 'a-1', severity: 'high' }),
        ),
      };
      const def = createCustomToolDefinition(makeTool(), executor, sessionCtx);
      const result = await def.execute({}, makeToolContext());

      expect(sessionCtx.storeBackend?.put).toHaveBeenCalledWith(
        'test-app', 'alerts', 'a-1', { alert_id: 'a-1', severity: 'high' }, {},
      );
      expect(result).toEqual({ key: 'a-1' });
    });

    it('throws when store backend is not available', async () => {
      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) =>
          (ctx as { store: (n: string, p: Record<string, unknown>) => Promise<unknown> })
            .store('alerts', { alert_id: 'a-1' }),
        ),
      };
      const def = createCustomToolDefinition(
        makeTool(), executor, makeSessionCtx({ storeBackend: undefined }),
      );

      await expect(def.execute({}, makeToolContext()))
        .rejects.toThrow('Store backend not available');
    });
  });

  describe('ctx.env()', () => {
    it('returns env var when in allowlist', async () => {
      vi.stubEnv('TEST_KEY', 'secret-value');
      let envResult: string | undefined;

      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) => {
          envResult = (ctx as { env: (n: string) => string | undefined }).env('TEST_KEY');
          return { ok: true };
        }),
      };
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());
      await def.execute({}, makeToolContext());

      expect(envResult).toBe('secret-value');
      vi.unstubAllEnvs();
    });

    it('returns undefined for non-allowlisted env var', async () => {
      let envResult: string | undefined = 'should-be-overwritten';

      const executor: CustomToolExecutor = {
        execute: vi.fn().mockImplementation(async (_tool, _params, ctx) => {
          envResult = (ctx as { env: (n: string) => string | undefined }).env('HOME');
          return { ok: true };
        }),
      };
      const def = createCustomToolDefinition(makeTool(), executor, makeSessionCtx());
      await def.execute({}, makeToolContext());

      expect(envResult).toBeUndefined();
    });
  });
});
