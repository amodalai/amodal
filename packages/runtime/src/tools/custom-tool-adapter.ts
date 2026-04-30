/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Adapts custom tools (handler.ts → esbuild → dynamic import) to
 * ToolDefinition objects for the new ToolRegistry.
 *
 * The compiled handler exports `default async function(params, ctx)`.
 * This adapter wraps it with:
 * - A Zod schema derived from the tool's JSON Schema parameters
 * - A ToolContext that provides request(), store(), exec(), env(), log()
 * - Timeout + abort signal handling
 * - Read-only enforcement (confirm: false → GET only)
 */

import {jsonSchema} from 'ai';
import type {LoadedTool, CustomToolExecutor, CustomToolContext} from '@amodalai/types';

import {ToolExecutionError} from '../errors.js';
import {log} from '../logger.js';
import {resolveKey} from '../stores/key-resolver.js';
import {LOCAL_APP_ID} from '../constants.js';
import type {ToolDefinition, ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Build CustomToolContext from ToolContext + session state
// ---------------------------------------------------------------------------

export interface CustomToolSessionContext {
  config: {
    getConnections(): Record<string, unknown>;
    getStores(): Array<{name: string; entity: {key: string; schema: Record<string, unknown>}}>;
  };
  storeBackend?: {
    put(appId: string, scopeId: string, store: string, key: string, payload: Record<string, unknown>, meta: Record<string, unknown>): Promise<void>;
  };
  appId?: string;
  shellExecutor?: {
    exec(command: string, options?: {cwd?: string; timeout?: number}): Promise<{stdout: string; stderr: string; exitCode: number}>;
  };
}

function buildCustomToolContext(
  tool: LoadedTool,
  sessionCtx: CustomToolSessionContext,
  runtimeCtx: ToolContext,
): CustomToolContext {
  const timeoutSignal = AbortSignal.timeout(tool.timeout);
  const combinedSignal = AbortSignal.any([runtimeCtx.signal, timeoutSignal]);

  return {
    async request(connection, endpoint, params) {
      const connections = sessionCtx.config.getConnections();
      const connConfig = connections[connection];
      if (!connConfig) {
        throw new ToolExecutionError(`Connection "${connection}" not found`, {
          toolName: tool.name,
          callId: '',
          context: {connection},
        });
      }

      const method = params?.method ?? 'GET';
      if (tool.confirm === false && method !== 'GET') {
        throw new ToolExecutionError(
          `Tool "${tool.name}" has confirm: false — only GET requests are allowed.`,
          {toolName: tool.name, callId: '', context: {method}},
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- connection config shape from buildConnectionsMap
      const conn = connConfig as Record<string, unknown>;
      const baseUrl = String(conn['base_url'] ?? '');
      if (!baseUrl) {
        throw new ToolExecutionError(`Connection "${connection}" has no base_url`, {
          toolName: tool.name,
          callId: '',
          context: {connection},
        });
      }

      // Build headers — start with defaults, apply auth from _request_config
      const headers: Record<string, string> = {'Content-Type': 'application/json'};

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- internal config shape
      const reqConfig = conn['_request_config'] as {
        auth?: Array<{header: string; value_template: string}>;
        default_headers?: Record<string, string>;
      } | undefined;

      if (reqConfig?.default_headers) {
        Object.assign(headers, reqConfig.default_headers);
      }

      if (reqConfig?.auth) {
        for (const authEntry of reqConfig.auth) {
          // value_template is pre-resolved by buildConnectionsMap
          headers[authEntry.header] = authEntry.value_template;
        }
      }

      const url = `${baseUrl}${endpoint}`;
      const fetchOpts: RequestInit = {
        method,
        signal: combinedSignal,
        headers,
      };
      if (params?.data) {
        fetchOpts.body = JSON.stringify(params.data);
      }

      const res = await fetch(url, fetchOpts);
      const body = await res.text();

      if (!res.ok) {
        throw new ToolExecutionError(
          `${method} ${url} returned ${String(res.status)}: ${body.slice(0, 500)}`,
          {toolName: tool.name, callId: '', context: {connection, endpoint, status: res.status}},
        );
      }

      try {
        return JSON.parse(body) as unknown;
      } catch {
        return {text: body, status: res.status};
      }
    },

    async store(storeName, payload) {
      if (!sessionCtx.storeBackend) {
        throw new ToolExecutionError('Store backend not available', {
          toolName: tool.name,
          callId: '',
          context: {storeName},
        });
      }
      const stores = sessionCtx.config.getStores();
      const storeDef = stores.find((s) => s.name === storeName);
      if (!storeDef) {
        throw new ToolExecutionError(`Store "${storeName}" not found`, {
          toolName: tool.name,
          callId: '',
          context: {storeName},
        });
      }
      const key = resolveKey(storeDef.entity.key, payload);
      const appId = sessionCtx.appId ?? LOCAL_APP_ID;
      await sessionCtx.storeBackend.put(appId, runtimeCtx.scopeId, storeName, key, payload, {});
      return {key};
    },

    async exec(command, options) {
      if (sessionCtx.shellExecutor) {
        return sessionCtx.shellExecutor.exec(command, options);
      }
      const {exec: execCb} = await import('node:child_process');
      const {promisify} = await import('node:util');
      const execAsync = promisify(execCb);
      try {
        const {stdout, stderr} = await execAsync(command, {
          signal: combinedSignal,
          timeout: options?.timeout ?? tool.timeout,
          cwd: options?.cwd,
        });
        return {stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0};
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- exec error shape
        const e = err as {stdout?: string; stderr?: string; code?: number};
        return {stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1};
      }
    },

    env(name) {
      if (!tool.env.includes(name)) return undefined;
      return process.env[name];
    },

    log(message) {
      runtimeCtx.log(message);
    },

    emit(event) {
      // Structural pass-through — the @amodalai/types CustomToolInlineEvent
      // union and the runtime-internal ToolInlineEvent are structurally
      // identical (same SSE event shapes) but live in two packages that
      // each declare their own SSEEventType enum. Cast through unknown
      // at the boundary; the legacy custom-tool surface keeps emitting
      // exactly the same SSE wire shape it always did.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cross-package SSE type alignment
      runtimeCtx.emit?.(event as unknown as Parameters<NonNullable<typeof runtimeCtx.emit>>[0]);
    },

    signal: combinedSignal,
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a ToolDefinition from a LoadedTool.
 *
 * The returned definition can be registered on the ToolRegistry. When the
 * LLM calls the tool, the executor compiles the handler (if needed) and
 * runs it with the full CustomToolContext.
 */
export function createCustomToolDefinition(
  tool: LoadedTool,
  executor: CustomToolExecutor,
  sessionCtx: CustomToolSessionContext,
): ToolDefinition {
  // Pass the tool's JSON Schema directly to the AI SDK so the LLM sees
  // the full parameter descriptions, types, and required fields from tool.json.
  const schema = jsonSchema(tool.parameters);

  return {
    description: tool.description,
    parameters: schema,
    readOnly: tool.confirm === false,
    metadata: {
      category: 'custom',
    },

    async execute(params: unknown, ctx: ToolContext): Promise<unknown> {
      const customCtx = buildCustomToolContext(tool, sessionCtx, ctx);
      const validatedParams: Record<string, unknown> =
        typeof params === 'object' && params !== null
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- params validated by Zod schema before reaching execute
          ? params as Record<string, unknown>
          : {};

      log.debug('custom_tool_execute', {
        tool: tool.name,
        tag: 'tool',
      });

      try {
        const result = await executor.execute(tool, validatedParams, customCtx);
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ToolExecutionError(`Tool "${tool.name}" was aborted`, {
            toolName: tool.name,
            callId: '',
          });
        }
        throw new ToolExecutionError(
          `Tool "${tool.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          {
            toolName: tool.name,
            callId: '',
            cause: err instanceof Error ? err : undefined,
          },
        );
      }
    },
  };
}
