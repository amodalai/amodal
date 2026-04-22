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

import type {LoadedStore, StoreBackend, LoadedConnection} from '@amodalai/types';
import type {FieldScrubber} from '@amodalai/core';
import type {ConnectionsMap} from '../tools/request-tool.js';
import type {SearchProvider} from '../providers/search-provider.js';
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
  /**
   * Raw loaded connections — keyed by name. Used to look up contextInjection
   * config that is not present in the rendered connectionsMap.
   */
  loadedConnections?: Map<string, LoadedConnection>;
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
  /** Session ID for correlation */
  sessionId: string;
  /** Scope ID for per-user session isolation. Empty string means agent-level (no scope). */
  scopeId: string;
  /** Scope context key-value pairs associated with this scope (from JWT claims or request body). */
  scopeContext?: Record<string, string>;
  /** Grounded search provider for web_search/fetch_url (optional). */
  searchProvider?: SearchProvider;
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

  // Apply context injection — resolve scopeContext values into the request
  // based on the connection's contextInjection config.
  const loadedConn = opts.loadedConnections?.get(connection);
  const contextInjection = loadedConn?.spec.contextInjection;
  const injectedQueryParams: Record<string, string> = {};
  const injectedHeaders: Record<string, string> = {};
  const injectedBodyFields: Record<string, string> = {};

  if (contextInjection) {
    for (const [contextKey, injection] of Object.entries(contextInjection)) {
      const value = opts.scopeContext?.[contextKey];
      if (value === undefined) {
        if (injection.required) {
          throw new ConnectionError(
            `Required context injection key "${contextKey}" is missing from scope context for connection "${connection}"`,
            {connection, action: `${method} ${endpoint}`},
          );
        }
        // Optional — skip
        continue;
      }
      switch (injection.in) {
        case 'query':
          injectedQueryParams[injection.field] = value;
          break;
        case 'header':
          injectedHeaders[injection.field] = value;
          break;
        case 'path':
          url = url.replace(`{${injection.field}}`, encodeURIComponent(value));
          break;
        case 'body':
          injectedBodyFields[injection.field] = value;
          break;
        default: {
          const _exhaustive: never = injection.in;
          throw new ConnectionError(
            `Unknown context injection location "${String(_exhaustive)}" for key "${contextKey}"`,
            {connection, action: `${method} ${endpoint}`},
          );
        }
      }
    }
  }

  // Add query params (caller params take precedence over injected params)
  const mergedQueryParams = {...injectedQueryParams, ...params?.params};
  if (Object.keys(mergedQueryParams).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(mergedQueryParams)) {
      searchParams.set(k, v);
    }
    const qs = searchParams.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }

  // Build headers (injected headers go in before auth so auth always takes precedence)
  const headers: Record<string, string> = {'Content-Type': 'application/json', ...injectedHeaders};
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

  // Merge body injection fields with caller data (caller data takes precedence)
  let requestData = params?.data;
  if (Object.keys(injectedBodyFields).length > 0 && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    if (requestData !== null && requestData !== undefined && typeof requestData === 'object' && !Array.isArray(requestData)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary (requestData checked with typeof above)
      const existingBody = requestData as Record<string, unknown>;
      for (const [k, v] of Object.entries(existingBody)) {
        injectedBodyFields[k] = String(v);
      }
      requestData = injectedBodyFields;
    } else if (requestData === undefined) {
      requestData = injectedBodyFields;
    }
    // If requestData is a primitive or array, body injection is not applicable — skip
  }

  const requestSignal = signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const fetchOpts: RequestInit = {method, headers, signal: requestSignal};
  if (requestData !== undefined && requestData !== null && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    fetchOpts.body = JSON.stringify(requestData);
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

        // Race against abort signal so a hung database doesn't block forever
        await Promise.race([
          opts.storeBackend.put(opts.appId, opts.scopeId, storeName, key, payload, {}),
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
        });
      },

      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      sessionId: opts.sessionId,
      scopeId: opts.scopeId,
      ...(opts.scopeContext ? {scopeContext: opts.scopeContext} : {}),
      ...(opts.searchProvider ? {searchProvider: opts.searchProvider} : {}),
    };
    return ctx;
  };
}
