/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Connection request tool rewritten for the new ToolRegistry (Phase 2.3).
 *
 * Makes HTTP requests through configured connections with:
 * - Permission checking via PermissionChecker interface
 * - Field scrubbing on responses
 * - Intent-based write confirmation flow
 * - Auth header injection from connection config
 * - Environment variable expansion in endpoints
 */

import {z} from 'zod';
import type {FieldScrubber} from '@amodalai/core';
import {ConnectionError} from '../errors.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import type {ToolDefinition, ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REQUEST_TOOL_NAME = 'request';

const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Params schema
// ---------------------------------------------------------------------------

const RequestParamsSchema = z.object({
  connection: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  endpoint: z.string().min(1),
  params: z.record(z.string()).optional(),
  data: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
  intent: z.enum(['read', 'write', 'confirmed_write']),
});

type RequestParams = z.infer<typeof RequestParamsSchema>;

// ---------------------------------------------------------------------------
// Connection map types (from buildConnectionsMap output)
// ---------------------------------------------------------------------------

interface ConnectionRequestConfig {
  base_url_field: string;
  auth?: Array<{header: string; value_template: string}>;
  default_headers?: Record<string, string>;
}

export interface ConnectionsMap {
  [connection: string]: Record<string, unknown> & {
    base_url?: string;
    _request_config?: ConnectionRequestConfig;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve auth template variables: "Bearer {{API_KEY}}" → "Bearer token123"
 */
function resolveAuthTemplate(template: string, connectionConfig: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    const value = connectionConfig[varName];
    return value !== undefined ? String(value) : '';
  });
}

/**
 * Expand $ENV_VAR references in a string using session-scoped env.
 * Uses replaceAll loop instead of regex to avoid greedy matching
 * ($FOO would incorrectly match inside $FOOBAR with regex).
 */
function expandEnvVars(value: string, sessionEnv: Record<string, string>): string {
  let result = value;
  for (const [key, val] of Object.entries(sessionEnv)) {
    result = result.replaceAll(`$${key}`, val);
  }
  return result;
}

/**
 * Build headers from connection config auth + defaults + user overrides.
 */
function buildHeaders(
  connectionConfig: Record<string, unknown>,
  requestConfig: ConnectionRequestConfig | undefined,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Default headers from connection config
  if (requestConfig?.default_headers) {
    Object.assign(headers, requestConfig.default_headers);
  }

  // Auth headers
  if (requestConfig?.auth) {
    for (const authEntry of requestConfig.auth) {
      headers[authEntry.header] = resolveAuthTemplate(authEntry.value_template, connectionConfig);
    }
  }

  // User-provided headers (override defaults)
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateRequestToolOptions {
  /** Connection configs from buildConnectionsMap() */
  connectionsMap: ConnectionsMap;
  /** Permission checker (reads from access.json by default) */
  permissionChecker: PermissionChecker;
  /** Field scrubber for response sanitization (optional) */
  fieldScrubber?: FieldScrubber;
  /** Session-scoped environment variables */
  sessionEnv?: Record<string, string>;
  /** Whether this is a read-only context (task agents) */
  readOnly?: boolean;
  /** Callback to check if plan mode is active */
  planModeActive?: () => boolean;
}

/**
 * Create the connection request tool.
 */
export function createRequestTool(options: CreateRequestToolOptions): ToolDefinition {
  const {connectionsMap, permissionChecker, fieldScrubber, sessionEnv = {}, readOnly = false, planModeActive} = options;

  return {
    description: 'Make an HTTP request to a configured connection. Use intent "write" for mutating operations (POST, PUT, PATCH, DELETE) — a preview will be shown first. Then call again with intent "confirmed_write" to execute.',
    parameters: RequestParamsSchema,
    readOnly: false,
    metadata: {category: 'connection'},

    async execute(params: RequestParams, ctx: ToolContext): Promise<unknown> {
      const {connection, method, endpoint, data, headers: extraHeaders, intent} = params;

      // Resolve connection config
      const connConfig = connectionsMap[connection];
      if (!connConfig) {
        throw new ConnectionError(`Connection "${connection}" not found`, {
          connection,
          action: `${method} ${endpoint}`,
        });
      }

      const requestConfig = connConfig['_request_config'];
      const baseUrl = connConfig['base_url'];
      if (!baseUrl || typeof baseUrl !== 'string') {
        throw new ConnectionError(`Connection "${connection}" has no base_url configured`, {
          connection,
          action: `${method} ${endpoint}`,
        });
      }

      // Build endpoint path
      const endpointPath = `${method.toUpperCase()} ${endpoint}`;

      // Permission check
      const permission = permissionChecker.check({
        connection,
        endpointPath,
        intent,
        method,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- data validated as object above
        params: typeof data === 'object' && data !== null ? data as Record<string, unknown> : undefined,
        readOnly,
        planModeActive: planModeActive?.() ?? false,
      });

      if (!permission.allowed) {
        return {error: permission.reason};
      }

      // Write preview flow
      if (permission.allowed && permission.requiresConfirmation && intent === 'write') {
        return {
          preview: true,
          method: method.toUpperCase(),
          endpoint,
          connection,
          reason: permission.reason,
          instruction: 'Call this tool again with intent "confirmed_write" to execute.',
        };
      }

      // Build URL
      const expandedEndpoint = expandEnvVars(endpoint, sessionEnv);
      // Strip trailing/leading slashes without regex (CodeQL flags /\/+$/ on library input)
      let cleanBase = baseUrl;
      while (cleanBase.endsWith('/')) cleanBase = cleanBase.slice(0, -1);
      let cleanEndpoint = expandedEndpoint;
      while (cleanEndpoint.startsWith('/')) cleanEndpoint = cleanEndpoint.slice(1);
      let url = `${cleanBase}/${cleanEndpoint}`;

      // Append query params
      if (params.params) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params.params)) {
          searchParams.set(key, expandEnvVars(String(value), sessionEnv));
        }
        url += `?${searchParams.toString()}`;
      }

      // Build headers
      const resolvedHeaders = buildHeaders(connConfig, requestConfig, extraHeaders);

      // Execute HTTP request
      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers: resolvedHeaders,
        signal: ctx.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      };

      if (data !== undefined && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        fetchOptions.body = JSON.stringify(data);
        resolvedHeaders['Content-Type'] = resolvedHeaders['Content-Type'] ?? 'application/json';
      }

      const response = await fetch(url, fetchOptions);
      const responseText = await response.text();

      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      // Field scrubbing
      if (fieldScrubber && typeof responseData === 'object' && responseData !== null) {
        const scrubResult = fieldScrubber.scrub(responseData, connection, endpointPath);
        return {
          status: response.status,
          data: scrubResult.data,
          ...(scrubResult.strippedCount > 0 ? {fields_stripped: scrubResult.strippedCount} : {}),
        };
      }

      return {
        status: response.status,
        data: responseData,
      };
    },
  };
}
