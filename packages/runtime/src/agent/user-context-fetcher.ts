/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AmodalRepo} from '@amodalai/core';
import type {ConnectionsMap} from '@amodalai/core';

/**
 * Fetches user context from a configured endpoint.
 *
 * The `config.userContext` value is a string like "GET crm/users/me"
 * (method connection/path). The connection auth is resolved from
 * the connections map.
 */
export async function fetchUserContext(
  repo: AmodalRepo,
  appToken: string,
  connectionsMap: ConnectionsMap,
): Promise<Record<string, unknown>> {
  const spec = repo.config.userContext;
  if (!spec) {
    return {};
  }

  const parsed = parseUserContextSpec(spec);
  if (!parsed) {
    return {};
  }

  const connConfig = connectionsMap[parsed.connection];
  if (!connConfig) {
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: connections map values are records
  const baseUrl = (connConfig as Record<string, unknown>)['base_url'] as string | undefined;
  if (!baseUrl) {
    return {};
  }

  const url = `${baseUrl.replace(/\/$/, '')}/${parsed.path.replace(/^\//, '')}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${appToken}`,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: parsed.method,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {};
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: expecting JSON object from API
    const data = (await response.json()) as Record<string, unknown>;
    return data;
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

interface ParsedSpec {
  method: string;
  connection: string;
  path: string;
}

/**
 * Parse "GET crm/users/me" → {method: "GET", connection: "crm", path: "users/me"}
 */
function parseUserContextSpec(spec: string): ParsedSpec | null {
  const parts = spec.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const method = parts[0]?.toUpperCase() ?? '';
  const fullPath = parts[1] ?? '';

  const slashIdx = fullPath.indexOf('/');
  if (slashIdx === -1) {
    return {method, connection: fullPath, path: '/'};
  }

  return {
    method,
    connection: fullPath.substring(0, slashIdx),
    path: fullPath.substring(slashIdx),
  };
}

export {parseUserContextSpec as _parseUserContextSpecForTesting};
