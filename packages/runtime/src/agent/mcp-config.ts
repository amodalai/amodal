/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * MCP server configuration builder.
 *
 * Extracts MCP server definitions from the agent bundle's connections
 * and mcpServers config. Used by both local-server and createAgent.
 */

import type {AgentBundle} from '@amodalai/types';

const ENV_PREFIX = 'env:';

/** Resolve env:VAR references in a Record. */
function resolveEnvRefs(obj: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value.startsWith(ENV_PREFIX)) {
      const envName = value.slice(ENV_PREFIX.length);
      const resolved = process.env[envName];
      if (resolved === undefined) {
        result[key] = '';
      } else {
        result[key] = resolved;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

export type McpServerConfig = {
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  trust?: boolean;
};

/**
 * Build MCP server configs from an agent bundle.
 *
 * Reads connection specs with `protocol: 'mcp'` and merges with
 * `bundle.mcpServers` (from amodal.json mcp section).
 */
export function buildMcpConfigs(bundle: AgentBundle): Record<string, McpServerConfig> {
  const configs: Record<string, McpServerConfig> = {};

  for (const [name, conn] of bundle.connections) {
    if (conn.spec.protocol === 'mcp') {
      configs[name] = {
        transport: conn.spec.transport ?? 'stdio',
        command: conn.spec.command,
        args: conn.spec.args,
        env: conn.spec.env ? resolveEnvRefs(conn.spec.env) : undefined,
        url: conn.spec.url,
        headers: conn.spec.headers ? resolveEnvRefs(conn.spec.headers) : undefined,
        trust: conn.spec.trust,
      };
    }
  }

  if (bundle.mcpServers) {
    for (const [name, config] of Object.entries(bundle.mcpServers)) {
      if (!configs[name]) {
        configs[name] = config;
      }
    }
  }

  return configs;
}
