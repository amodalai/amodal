/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import type {CommandModule} from 'yargs';
import {loadRepo, readLockFile, resolveAllPackages, McpManager} from '@amodalai/core';
import type {ConnectionSpec} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface ValidateOptions {
  cwd?: string;
  packages?: boolean;
  skipTest?: boolean;
}

interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

interface LiveTestResult {
  name: string;
  type: 'REST' | 'MCP';
  status: 'pass' | 'fail';
  detail: string;
  durationMs: number;
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
function buildSpecAuthHeaders(
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

  if (auth.type === 'none') {
    return {};
  }

  return {};
}

/**
 * Test a single REST connection. Never throws.
 */
async function testRestConnection(
  name: string,
  spec: ConnectionSpec,
  envVars: Map<string, string>,
): Promise<LiveTestResult> {
  const start = Date.now();
  try {
    let baseUrl = spec.baseUrl;
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
    // (fetch strips auth headers on redirects)
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

    // Any HTTP response means the server is reachable and auth was attempted.
    // 2xx/3xx/404 = pass (server is up, auth accepted or endpoint not found).
    // 401/403 = fail (auth rejected).
    // 5xx = fail (server error).
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
async function testMcpServers(
  configs: Record<string, {transport: string; url?: string; command?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string>; trust?: boolean}>,
): Promise<LiveTestResult[]> {
  const manager = new McpManager();
  const start = Date.now();

  try {
    // Wrap with a 30-second overall timeout
    await Promise.race([
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      manager.startServers(configs as Record<string, Parameters<typeof manager.startServers>[0][string]>),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('MCP startup timeout')), 30_000)),
    ]);
  } catch {
    // Timeout or other error — still collect what we can
  }

  const results: LiveTestResult[] = [];
  for (const info of manager.getServerInfo()) {
    const durationMs = Date.now() - start;
    if (info.status === 'connected') {
      results.push({
        name: info.name,
        type: 'MCP',
        status: 'pass',
        detail: `${info.tools.length} tools`,
        durationMs,
      });
    } else {
      results.push({
        name: info.name,
        type: 'MCP',
        status: 'fail',
        detail: info.error ?? info.status,
        durationMs,
      });
    }
  }

  await manager.shutdown();
  return results;
}

/**
 * Load .env file and inject values into process.env.
 * Handles both plain KEY=value and export KEY=value formats.
 */
async function loadEnvIntoProcess(repoPath: string): Promise<Map<string, string>> {
  const envPath = join(repoPath, '.env');
  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    return new Map();
  }

  // Strip 'export ' prefix before parsing
  const cleaned = content
    .split('\n')
    .map((line) => line.replace(/^export\s+/, ''))
    .join('\n');

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
      // Only set if not already in process.env (don't override explicit env)
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
  return entries;
}

/**
 * Validates the amodal project configuration by loading the full repo
 * and running cross-reference checks.
 *
 * Returns the number of errors found (0 = valid).
 */
export async function runValidate(options: ValidateOptions = {}): Promise<number> {
  const issues: ValidationIssue[] = [];

  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[validate] ${msg}\n`);
    return 1;
  }

  // Load .env into process.env before loadRepo so env: references resolve
  let envVars = new Map<string, string>();
  if (!options.skipTest) {
    envVars = await loadEnvIntoProcess(repoPath);
  }

  process.stderr.write(`[validate] Loading repo from ${repoPath}\n`);

  try {
    const repo = await loadRepo({localPath: repoPath});

    // Check: at least one connection
    if (repo.connections.size === 0) {
      issues.push({level: 'warning', message: 'No connections defined. The agent cannot access external systems.'});
    }

    // Check: surface endpoints reference valid access config
    for (const [name, conn] of repo.connections) {
      if (conn.surface.length === 0) {
        issues.push({level: 'warning', message: `Connection "${name}" has no surface endpoints.`});
      }
    }

    // Check: skills have non-empty bodies
    for (const skill of repo.skills) {
      if (!skill.body.trim()) {
        issues.push({level: 'error', message: `Skill "${skill.name}" has an empty body.`});
      }
    }

    // Check: automations have schedules
    for (const auto of repo.automations) {
      if (!auto.schedule) {
        issues.push({level: 'warning', message: `Automation "${auto.name}" has no schedule. It will only run via webhook.`});
      }
    }

    // Live connection tests
    if (!options.skipTest) {
      process.stderr.write('\n[validate] Testing live connections...\n');
      const liveResults: LiveTestResult[] = [];

      // Test REST connections in parallel
      const restPromises = [...repo.connections.entries()].map(([name, conn]) =>
        testRestConnection(name, conn.spec, envVars),
      );
      const restResults = await Promise.allSettled(restPromises);
      for (const result of restResults) {
        if (result.status === 'fulfilled') {
          liveResults.push(result.value);
        }
      }

      // Test MCP servers
      if (repo.mcpServers && Object.keys(repo.mcpServers).length > 0) {
        const mcpResults = await testMcpServers(repo.mcpServers);
        liveResults.push(...mcpResults);
      }

      // Print results table
      process.stderr.write('\n');
      const nameWidth = Math.max(20, ...liveResults.map((r) => r.name.length + 2));
      process.stderr.write(
        `  ${'CONNECTION'.padEnd(nameWidth)} ${'TYPE'.padEnd(6)} ${'STATUS'.padEnd(8)} DETAILS\n`,
      );
      for (const r of liveResults) {
        const statusStr = r.status === 'pass' ? '  OK  ' : ' FAIL ';
        const durationStr = r.durationMs > 0 ? ` (${r.durationMs}ms)` : '';
        process.stderr.write(
          `  ${r.name.padEnd(nameWidth)} ${r.type.padEnd(6)} ${statusStr.padEnd(8)} ${r.detail}${durationStr}\n`,
        );
      }
      process.stderr.write('\n');

      // Add failures to issues
      for (const r of liveResults) {
        if (r.status === 'fail') {
          issues.push({level: 'error', message: `${r.type} connection "${r.name}" failed: ${r.detail}`});
        }
      }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push({level: 'error', message: `Failed to load repo: ${msg}`});
  }

  // Package-aware validation
  if (options.packages) {
    try {
      const lockFile = await readLockFile(repoPath);
      if (lockFile) {
        const resolved = await resolveAllPackages({repoPath, lockFile});

        // Report warnings from resolution (missing packages, broken symlinks)
        for (const warning of resolved.warnings) {
          issues.push({level: 'warning', message: warning});
        }

        // Check for empty resolved connections
        for (const [name, conn] of resolved.connections) {
          if (conn.surface.length === 0) {
            issues.push({level: 'warning', message: `Resolved connection "${name}" has no surface endpoints.`});
          }
        }

        // Check for empty resolved skills
        for (const skill of resolved.skills) {
          if (!skill.body.trim()) {
            issues.push({level: 'error', message: `Resolved skill "${skill.name}" has an empty body.`});
          }
        }
      } else {
        process.stderr.write('[validate] No lock file found, skipping package validation.\n');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push({level: 'error', message: `Package resolution failed: ${msg}`});
    }
  }

  // Print results
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  for (const issue of errors) {
    process.stderr.write(`  ERROR: ${issue.message}\n`);
  }
  for (const issue of warnings) {
    process.stderr.write(`  WARN:  ${issue.message}\n`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    process.stderr.write('[validate] All checks passed.\n');
  } else {
    process.stderr.write(`[validate] ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  }

  return errors.length;
}

export const validateCommand: CommandModule = {
  command: 'validate',
  describe: 'Validate the project configuration',
  builder: (yargs) =>
    yargs
      .option('packages', {type: 'boolean', default: false, describe: 'Include package resolution validation'})
      .option('skip-test', {type: 'boolean', default: false, describe: 'Skip live connection and MCP server tests'}),
  handler: async (argv) => {
    const code = await runValidate({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      packages: argv['packages'] as boolean,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      skipTest: argv['skipTest'] as boolean,
    });
    process.exit(code);
  },
};
