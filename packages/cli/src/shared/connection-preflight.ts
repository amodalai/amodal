/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {loadRepo, McpManager} from '@amodalai/core';
import type {ConnectionSpec} from '@amodalai/core';

export interface LiveTestResult {
  name: string;
  type: 'REST' | 'MCP';
  status: 'pass' | 'fail';
  detail: string;
  durationMs: number;
}

export interface PreflightReport {
  results: LiveTestResult[];
  hasFailures: boolean;
}

/**
 * Resolve an env:VAR_NAME reference using a Map of env vars.
 */
function resolveEnvToken(value: string, envVars: Map<string, string>): string {
  if (!value.startsWith('env:')) return value;
  const varName = value.slice(4);
  return envVars.get(varName) ?? process.env[varName] ?? '';
}

/**
 * Build auth headers from a connection spec's auth config.
 */
export function buildSpecAuthHeaders(
  auth: ConnectionSpec['auth'],
  envVars: Map<string, string>,
): Record<string, string> {
  if (!auth) return {};

  const token = auth.token ? resolveEnvToken(auth.token, envVars) : '';

  if (auth.type === 'bearer') {
    const header = auth.header ?? 'Authorization';
    const prefix = auth.prefix ?? 'Bearer';
    return token ? {[header]: `${prefix} ${token}`} : {};
  }

  if (auth.type === 'api_key' || auth.type === 'api-key') {
    const header = auth.header ?? 'X-API-Key';
    return token ? {[header]: token} : {};
  }

  if (auth.type === 'basic') {
    return token ? {Authorization: `Basic ${token}`} : {};
  }

  if (auth.type === 'header') {
    const header = auth.header ?? 'Authorization';
    return token ? {[header]: token} : {};
  }

  return {};
}

/**
 * Test a single REST connection. Never throws.
 */
export async function testRestConnection(
  name: string,
  spec: ConnectionSpec,
  envVars: Map<string, string>,
): Promise<LiveTestResult> {
  const start = Date.now();
  try {
    let baseUrl = spec.baseUrl ?? '';
    if (baseUrl.startsWith('env:')) {
      baseUrl = resolveEnvToken(baseUrl, envVars);
    }
    if (!baseUrl) {
      return {name, type: 'REST', status: 'fail', detail: 'baseUrl not resolved', durationMs: 0};
    }

    const testUrl = spec.testPath ? `${baseUrl.replace(/\/$/, '')}${spec.testPath}` : baseUrl;
    const headers = buildSpecAuthHeaders(spec.auth, envVars);
    const response = await fetch(testUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    // If we got a 401 after a redirect, retry the final URL with auth headers
    if (response.status === 401 && response.redirected) {
      const retryResponse = await fetch(response.url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      const durationMs = Date.now() - start;
      if (retryResponse.status === 401 || retryResponse.status === 403) {
        return {name, type: 'REST', status: 'fail', detail: `${retryResponse.status} Unauthorized`, durationMs};
      }
      if (retryResponse.status >= 500) {
        return {name, type: 'REST', status: 'fail', detail: `${retryResponse.status} Server Error`, durationMs};
      }
      return {name, type: 'REST', status: 'pass', detail: `${retryResponse.status} OK (after redirect)`, durationMs};
    }

    const durationMs = Date.now() - start;

    if (response.status === 401 || response.status === 403) {
      return {name, type: 'REST', status: 'fail', detail: `${response.status} Unauthorized`, durationMs};
    }
    if (response.status >= 500) {
      return {name, type: 'REST', status: 'fail', detail: `${response.status} Server Error`, durationMs};
    }
    return {name, type: 'REST', status: 'pass', detail: `${response.status} OK`, durationMs};
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return {name, type: 'REST', status: 'fail', detail: msg, durationMs};
  }
}

/**
 * Test MCP server connections. Never throws.
 */
export async function testMcpServers(
  configs: Record<string, {transport: string; url?: string; command?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string>; trust?: boolean}>,
): Promise<LiveTestResult[]> {
  const manager = new McpManager();
  const start = Date.now();

  try {
    await Promise.race([
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      manager.startServers(configs as Record<string, Parameters<typeof manager.startServers>[0][string]>),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('MCP startup timeout')), 30_000)),
    ]);
  } catch {
    // Timeout — still collect what we can
  }

  const results: LiveTestResult[] = [];
  for (const info of manager.getServerInfo()) {
    const durationMs = Date.now() - start;
    if (info.status === 'connected') {
      results.push({name: info.name, type: 'MCP', status: 'pass', detail: `${info.tools.length} tools`, durationMs});
    } else {
      results.push({name: info.name, type: 'MCP', status: 'fail', detail: info.error ?? info.status, durationMs});
    }
  }

  await manager.shutdown();
  return results;
}

/**
 * Load .env file and inject values into process.env.
 * Handles both plain KEY=value and export KEY=value formats.
 */
export async function loadEnvIntoProcess(repoPath: string): Promise<Map<string, string>> {
  const envPath = join(repoPath, '.env');
  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    return new Map();
  }

  const cleaned = content.split('\n').map((line) => line.replace(/^export\s+/, '')).join('\n');

  const entries = new Map<string, string>();
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) {
      entries.set(key, value);
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
  return entries;
}

/**
 * Print the preflight results table to stderr.
 */
export function printPreflightTable(results: LiveTestResult[]): void {
  const nameWidth = Math.max(20, ...results.map((r) => r.name.length + 2));
  process.stderr.write(
    `  ${'CONNECTION'.padEnd(nameWidth)} ${'TYPE'.padEnd(6)} ${'STATUS'.padEnd(8)} DETAILS\n`,
  );
  for (const r of results) {
    const statusStr = r.status === 'pass' ? '  OK  ' : ' FAIL ';
    const durationStr = r.durationMs > 0 ? ` (${r.durationMs}ms)` : '';
    process.stderr.write(
      `  ${r.name.padEnd(nameWidth)} ${r.type.padEnd(6)} ${statusStr.padEnd(8)} ${r.detail}${durationStr}\n`,
    );
  }
}

/**
 * Run preflight connection tests for a repo.
 * Loads .env, loads repo, tests REST connections and MCP servers.
 */
export async function runConnectionPreflight(repoPath: string): Promise<PreflightReport> {
  const envVars = await loadEnvIntoProcess(repoPath);

  let repo;
  try {
    repo = await loadRepo({localPath: repoPath});
  } catch {
    return {results: [], hasFailures: false};
  }

  const results: LiveTestResult[] = [];

  // Split connections by protocol
  const restConnections: Array<[string, typeof repo.connections extends Map<string, infer V> ? V : never]> = [];
  const mcpFromConnections: Record<string, {transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>}> = {};

  for (const [name, conn] of repo.connections) {
    if (conn.spec.protocol === 'mcp') {
      // Resolve env: references in headers
      const resolvedHeaders: Record<string, string> = {};
      if (conn.spec.headers) {
        for (const [k, v] of Object.entries(conn.spec.headers)) {
          resolvedHeaders[k] = v.startsWith('env:') ? (envVars.get(v.slice(4)) ?? process.env[v.slice(4)] ?? '') : v;
        }
      }
      mcpFromConnections[name] = {
        transport: conn.spec.transport ?? 'stdio',
        command: conn.spec.command,
        args: conn.spec.args,
        env: conn.spec.env,
        url: conn.spec.url,
        headers: Object.keys(resolvedHeaders).length > 0 ? resolvedHeaders : undefined,
      };
    } else {
      restConnections.push([name, conn]);
    }
  }

  // Test REST connections in parallel
  const restPromises = restConnections.map(([name, conn]) =>
    testRestConnection(name, conn.spec, envVars),
  );
  const restResults = await Promise.allSettled(restPromises);
  for (const result of restResults) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    }
  }

  // Test MCP connections (from protocol:mcp connections + legacy mcp.servers)
  const allMcpConfigs = {...mcpFromConnections};
  if (repo.mcpServers) {
    for (const [name, config] of Object.entries(repo.mcpServers)) {
      if (!allMcpConfigs[name]) {
        allMcpConfigs[name] = config;
      }
    }
  }
  if (Object.keys(allMcpConfigs).length > 0) {
    const mcpResults = await testMcpServers(allMcpConfigs);
    results.push(...mcpResults);
  }

  return {
    results,
    hasFailures: results.some((r) => r.status === 'fail'),
  };
}
