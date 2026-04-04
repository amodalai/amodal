/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool Context Factory.
 *
 * Builds a ToolContext from session-level dependencies. This is the bridge
 * between the agent loop and tool implementations.
 *
 * Replaces the old `buildToolContext()` in agent/tool-context-builder.ts
 * which depended on the legacy AgentSession type. This factory takes
 * explicit dependencies and returns a factory function matching the
 * `AgentContext.buildToolContext` signature: `(callId: string) => ToolContext`.
 */

import type {LoadedStore, StoreBackend} from '@amodalai/types';
import type {FieldScrubber} from '@amodalai/core';
import type {ConnectionsMap} from '../tools/request-tool.js';
import type {ToolContext} from '../tools/types.js';
import type {Logger} from '../logger.js';
import {ConnectionError, StoreError} from '../errors.js';
import {resolveKey} from '../stores/key-resolver.js';

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

/** Dependencies for creating tool contexts. */
export interface ToolContextFactoryOptions {
  /** Connection configs (base_url, auth headers, etc.) */
  connectionsMap: ConnectionsMap;
  /** Shared store backend for ctx.store() */
  storeBackend: StoreBackend;
  /** Store definitions for key resolution */
  storeDefinitions: LoadedStore[];
  /** App ID for store isolation */
  appId: string;
  /** Allowlisted env vars: name → value. Only these are exposed via ctx.env(). */
  envAllowlist: Record<string, string | undefined>;
  /** Session-scoped logger */
  logger: Logger;
  /** Field scrubber for response sanitization (optional) */
  fieldScrubber?: FieldScrubber | null;
  /** User info */
  user: {roles: string[]; [key: string]: unknown};
  /** Session ID for correlation */
  sessionId: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId: string;
}

// ---------------------------------------------------------------------------
// Request implementation (internalized from request-helper.ts)
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Resolve auth template variables: "Bearer {{API_KEY}}" → "Bearer token123"
 */
function resolveAuthTemplate(template: string, connectionConfig: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    const value = connectionConfig[varName];
    return value !== undefined ? String(value) : '';
  });
}

async function makeRequest(
  opts: ToolContextFactoryOptions,
  connection: string,
  endpoint: string,
  params?: {method?: string; data?: unknown; params?: Record<string, string>},
  signal?: AbortSignal,
): Promise<unknown> {
  const method = params?.method ?? 'GET';

  const connConfig = opts.connectionsMap[connection];
  if (!connConfig) {
    const available = Object.keys(opts.connectionsMap);
    const suggestion = available.find((n) => n.toLowerCase() === connection.toLowerCase())
      ?? available.find((n) => connection.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(connection.toLowerCase()));
    throw new ConnectionError(
      `Connection "${connection}" not found. Available: ${available.join(', ') || '(none)'}${suggestion ? `. Did you mean "${suggestion}"?` : ''}`,
      {connection, action: `${method} ${endpoint}`},
    );
  }

  const baseUrl = connConfig.base_url;
  if (!baseUrl) {
    throw new ConnectionError(`Connection "${connection}" has no base_url`, {connection, action: `${method} ${endpoint}`});
  }
  let url = `${baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;

  // Add query params
  if (params?.params) {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params.params)) {
      searchParams.set(k, v);
    }
    const qs = searchParams.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }

  // Build headers
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  const reqConfig = connConfig._request_config;
  if (reqConfig?.auth) {
    for (const entry of reqConfig.auth) {
      headers[entry.header] = resolveAuthTemplate(entry.value_template, connConfig);
    }
  }
  if (reqConfig?.default_headers) {
    for (const [k, v] of Object.entries(reqConfig.default_headers)) {
      headers[k] = v;
    }
  }

  const requestSignal = signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const fetchOpts: RequestInit = {method, headers, signal: requestSignal};
  if (params?.data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    fetchOpts.body = JSON.stringify(params.data);
  }

  const response = await fetch(url, fetchOpts);
  const text = await response.text();

  // Field scrubbing — only attempt on valid JSON; scrubber errors propagate
  let output = text;
  if (opts.fieldScrubber) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON — skip scrubbing, return text as-is
      parsed = undefined;
    }
    if (parsed !== undefined) {
       
      const scrubResult = opts.fieldScrubber.scrub(parsed, connection, endpoint) as {data: unknown};
      output = JSON.stringify(scrubResult.data);
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ConnectionError(
        `Authentication failed (${String(response.status)}) for connection "${connection}". Check credentials.`,
        {connection, action: `${method} ${endpoint}`},
      );
    }
    throw new ConnectionError(
      `HTTP ${String(response.status)} from "${connection}" ${method} ${endpoint}: ${output.substring(0, 500)}`,
      {connection, action: `${method} ${endpoint}`},
    );
  }

  // Parse JSON response if possible
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return output;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a factory function that builds ToolContext instances for tool execution.
 *
 * The returned factory is passed as `AgentContext.buildToolContext`. The EXECUTING
 * state handler calls it once per tool execution with the tool call ID.
 *
 * The EXECUTING handler composes its own AbortSignal (session + per-tool timeout)
 * and overrides `ctx.signal` via object spread before passing to the tool's
 * execute function. Methods on this context read `ctx.signal` at call time
 * (not at creation time) so that the overridden signal propagates to HTTP
 * requests and other async operations.
 */
export function createToolContextFactory(
  opts: ToolContextFactoryOptions,
): (callId: string) => ToolContext {
  return (callId: string): ToolContext => {
    // Build ctx as a named object so methods can reference ctx.signal at
    // call time. When EXECUTING does `{...toolCtx, signal: combined}`, the
    // spread creates a new object — but the closures still capture `ctx`.
    // To fix this, EXECUTING must mutate `toolCtx.signal` directly instead
    // of spreading. The default signal here is a safety net in case
    // the caller doesn't override.
    const ctx: ToolContext = {
      async request(connection, endpoint, params) {
        opts.logger.debug('tool_context_request', {
          callId,
          connection,
          endpoint,
          method: params?.method ?? 'GET',
          session: opts.sessionId,
        });
        return makeRequest(opts, connection, endpoint, params, ctx.signal);
      },

      async store(storeName, payload) {
        const storeDef = opts.storeDefinitions.find((s) => s.name === storeName);
        if (!storeDef) {
          const available = opts.storeDefinitions.map((s) => s.name).join(', ');
          throw new StoreError(`Store "${storeName}" not found. Available: ${available || '(none)'}`, {
            store: storeName,
            operation: 'put',
            context: {available, session: opts.sessionId},
          });
        }
        const key = resolveKey(storeDef.entity.key, payload);

        opts.logger.debug('tool_context_store_write', {
          callId,
          store: storeName,
          key,
          session: opts.sessionId,
        });

        // Race against abort signal so a hung PGLite doesn't block forever
        await Promise.race([
          opts.storeBackend.put(opts.appId, storeName, key, payload, {}),
          new Promise<never>((_resolve, reject) => {
            if (ctx.signal.aborted) {
              reject(new StoreError('Store write timed out', {store: storeName, operation: 'put', context: {callId, key}}));
              return;
            }
            ctx.signal.addEventListener('abort', () => {
              reject(new StoreError('Store write timed out', {store: storeName, operation: 'put', context: {callId, key}}));
            }, {once: true});
          }),
        ]);

        opts.logger.debug('tool_context_store_complete', {
          callId,
          store: storeName,
          key,
          session: opts.sessionId,
        });
        return {key};
      },

      env(name) {
        if (!(name in opts.envAllowlist)) {
          return undefined;
        }
        return opts.envAllowlist[name];
      },

      log(message) {
        opts.logger.info('tool_log', {
          callId,
          message,
          session: opts.sessionId,
          tenant: opts.tenantId,
        });
      },

      user: opts.user,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
    };
    return ctx;
  };
}
