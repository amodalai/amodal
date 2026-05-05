/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedConnection} from '../repo/connection-types.js';
import type {ConnectionsMap} from '../templates/connections.js';
import type {AccessConfig} from '../repo/connection-schemas.js';

/**
 * Resolve an `env:VAR_NAME` reference to the actual value.
 * Falls back to `{{VAR_NAME}}` template syntax for runtime resolution
 * if the env var is not available at build time.
 */
function resolveEnvRef(value: string, credentials?: Record<string, string>): string {
  if (!value.startsWith('env:')) {
    return value;
  }
  const varName = value.slice(4);

  // Check injected credentials first
  if (credentials && credentials[varName] !== undefined) {
    return credentials[varName];
  }

  // Fall back to process.env
  const envVal = process.env[varName];
  if (envVal !== undefined) {
    return envVal;
  }

  // Leave as {{VAR}} template for runtime resolution
  return `{{${varName}}}`;
}

/**
 * Build a ConnectionsMap from LoadedConnections.
 *
 * Each entry has: base_url (from spec.baseUrl), _request_config with auth details,
 * and any injected credential values for {{VAR}} template resolution.
 */
export function buildConnectionsMap(
  connections: Map<string, LoadedConnection>,
  credentials?: Record<string, string>,
): ConnectionsMap {
  const result: ConnectionsMap = {};

  for (const [name, conn] of connections) {
    // Skip MCP connections — they use MCP tools, not the request tool
    if (conn.spec.protocol === 'mcp') continue;

    const auth = buildAuthHeaders(conn, credentials);

    const resolvedBaseUrl = resolveEnvRef(conn.spec.baseUrl ?? '', credentials);

    const entry: Record<string, unknown> = {
      base_url: resolvedBaseUrl,
      _request_config: {
        base_url_field: 'base_url',
        auth,
        default_headers: {},
      },
    };

    // Merge credential values into the connection config so
    // {{VAR}} templates in auth headers can be resolved at request time
    if (credentials) {
      for (const [key, val] of Object.entries(credentials)) {
        entry[key] = val;
      }
    }

    result[name] = entry;
  }

  return result;
}

/**
 * Build AccessConfig map keyed by connection name.
 */
export function buildAccessConfigs(
  connections: Map<string, LoadedConnection>,
): Map<string, AccessConfig> {
  const result = new Map<string, AccessConfig>();

  for (const [name, conn] of connections) {
    result.set(name, conn.access);
  }

  return result;
}

/**
 * Build auth header entries from a connection's spec.auth configuration.
 * Resolves env:VAR_NAME references in token values.
 */
function buildAuthHeaders(
  conn: LoadedConnection,
  credentials?: Record<string, string>,
): Array<{header: string; value_template: string}> {
  const specAuth = conn.spec.auth;
  if (!specAuth) {
    return [];
  }

  const rawToken = specAuth.token ?? '';
  const token = resolveEnvRef(rawToken, credentials);

  if (specAuth.type === 'bearer') {
    const header = specAuth.header ?? 'Authorization';
    const prefix = specAuth.prefix ?? 'Bearer';
    return [{header, value_template: `${prefix} ${token}`}];
  }

  if (specAuth.type === 'api_key' || specAuth.type === 'api-key') {
    const header = specAuth.header ?? 'X-API-Key';
    return [{header, value_template: token}];
  }

  if (specAuth.type === 'basic') {
    // For basic auth, token should be the base64-encoded user:pass
    // or two env:VAR refs separated by :
    return [{header: 'Authorization', value_template: `Basic ${token}`}];
  }

  if (specAuth.type === 'header') {
    // Custom header auth (e.g., X-Shopify-Access-Token)
    const header = specAuth.header ?? 'Authorization';
    return [{header, value_template: token}];
  }

  return [];
}
