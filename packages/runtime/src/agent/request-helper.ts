/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AgentSession} from './agent-types.js';

interface RequestResult {
  output?: string;
  error?: string;
}

/**
 * Execute an HTTP request through a connection.
 * Shared between the agent runner's request tool and custom tool ToolContext.request().
 */
export async function makeApiRequest(
  session: AgentSession,
  connectionName: string,
  method: string,
  endpoint: string,
  params?: Record<string, string> | unknown,
  data?: unknown,
  signal?: AbortSignal,
): Promise<RequestResult> {
  const connMap = session.runtime.connectionsMap;
  const connConfig = connMap[connectionName];
  if (!connConfig) {
    const available = Object.keys(connMap);
    const suggestion = available.find((n) => n.toLowerCase() === connectionName.toLowerCase())
      ?? available.find((n) => connectionName.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(connectionName.toLowerCase()));
    return {
      error: `Connection "${connectionName}" not found. Available connections: ${available.join(', ') || '(none)'}${suggestion ? `. Did you mean "${suggestion}"?` : ''}`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary
  const baseUrl = (connConfig as Record<string, unknown>)['base_url'] as string | undefined;
  if (!baseUrl) {
    return {error: `Connection ${connectionName} has no base_url`};
  }

  let url = `${baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;

  // Add query params
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      searchParams.set(k, String(v));
    }
    const qs = searchParams.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }

  // Build auth headers from _request_config
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary
  const reqConfig = (connConfig as Record<string, unknown>)['_request_config'] as Record<string, unknown> | undefined;
  if (reqConfig) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary
    const authEntries = reqConfig['auth'] as Array<{header: string; value_template: string}> | undefined;
    if (authEntries) {
      for (const entry of authEntries) {
        headers[entry.header] = entry.value_template;
      }
    }
  }

  try {
    const fetchOpts: RequestInit = {
      method,
      headers,
      signal,
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOpts.body = JSON.stringify(data);
    }

    const response = await fetch(url, fetchOpts);
    const text = await response.text();

    // Field scrubbing
    let output = text;
    if (session.runtime.fieldScrubber) {
      try {
        const parsed: unknown = JSON.parse(text);
        const scrubResult = session.runtime.fieldScrubber.scrub(parsed, connectionName, endpoint);
        output = JSON.stringify(scrubResult['data']);

        // Log telemetry
        session.runtime.telemetry.logScrub(scrubResult, connectionName, endpoint);
      } catch {
        // Not JSON — return as-is
      }
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {error: `Authentication failed (${response.status}) for connection "${connectionName}". Check that the auth credentials in .env are correct and not expired.`};
      }
      return {error: `HTTP ${response.status} from "${connectionName}" ${method} ${endpoint}: ${output.substring(0, 500)}`};
    }

    // Truncate large responses
    if (output.length > 8000) {
      output = output.substring(0, 8000) + '\n... (truncated)';
    }

    return {output};
  } catch (err) {
    if (signal?.aborted) {
      return {error: 'Request aborted'};
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {error: `Network error reaching "${connectionName}" at ${url}: ${msg}. Check that the service is running and the baseUrl is correct.`};
  }
}
