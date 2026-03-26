/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readEnvFile} from '@amodalai/core';
import type {PackageAuth} from '@amodalai/core';

import type {ConnectionTestReport, EndpointTestResult} from './types.js';

export interface TestConnectionOptions {
  connectionName: string;
  testEndpoints: string[];
  envFilePath: string;
  auth?: PackageAuth;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Substitute $VAR and ${VAR} placeholders in a URL.
 */
export function resolveEndpointUrl(
  url: string,
  envVars: Map<string, string>,
): string {
  return url.replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (_match, braced, bare) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- regex capture groups are string|undefined
    const varName = (braced ?? bare) as string;
    return envVars.get(varName) ?? '';
  });
}

/**
 * Build auth headers based on auth config and env vars.
 */
export function buildAuthHeaders(
  auth: PackageAuth | undefined,
  envVars: Map<string, string>,
): Record<string, string> {
  if (!auth) return {};

  switch (auth.type) {
    case 'bearer': {
      // Use first envVar value as the token
      const envVarEntries = auth['envVars'] ?? {};
      const firstKey = Object.keys(envVarEntries)[0];
      if (firstKey) {
        const token = envVars.get(firstKey) ?? '';
        if (token) {
          return {Authorization: `Bearer ${token}`};
        }
      }
      return {};
    }
    case 'api_key': {
      const headers: Record<string, string> = {};
      const headerDefs = auth['headers'] ?? {};
      for (const [headerName, template] of Object.entries(headerDefs)) {
        headers[headerName] = template.replace(
          /\$\{?([A-Z_][A-Z0-9_]*)\}?/g,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- regex capture group
          (_match, varName) => envVars.get(varName as string) ?? '',
        );
      }
      return headers;
    }
    case 'oauth2': {
      const envVarEntries = auth['envVars'] ?? {};
      // Look for access_token mapping or use first entry
      const tokenKey =
        Object.entries(envVarEntries).find(([, desc]) =>
          desc.toLowerCase().includes('access'),
        )?.[0] ?? Object.keys(envVarEntries)[0];
      if (tokenKey) {
        const token = envVars.get(tokenKey) ?? '';
        if (token) {
          return {Authorization: `Bearer ${token}`};
        }
      }
      return {};
    }
    default:
      return {};
  }
}

/**
 * Test a single endpoint. Never throws.
 */
async function testSingleEndpoint(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<EndpointTestResult> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const durationMs = Date.now() - start;

    if (!response.ok) {
      return {
        url,
        status: 'error',
        statusCode: response.status,
        error: `HTTP ${response.status}`,
        durationMs,
      };
    }

    // Best-effort record count extraction
    let recordCount: number | undefined;
    try {
      const body: unknown = await response.json();
      if (Array.isArray(body)) {
        recordCount = body.length;
      } else if (body && typeof body === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by typeof check above
        const obj = body as Record<string, unknown>;
        if (typeof obj['total'] === 'number') {
          recordCount = obj['total'];
        } else if (typeof obj['count'] === 'number') {
          recordCount = obj['count'];
        }
      }
    } catch {
      // Not JSON — that's fine
    }

    return {
      url,
      status: 'ok',
      statusCode: response.status,
      recordCount,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message =
      err instanceof Error ? err.message : 'Unknown error';
    return {
      url,
      status: 'error',
      error: message,
      durationMs,
    };
  }
}

/**
 * Test connection endpoints sequentially. Never throws.
 */
export async function testConnection(
  options: TestConnectionOptions,
): Promise<ConnectionTestReport> {
  const {
    connectionName,
    testEndpoints,
    envFilePath,
    auth,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const envVars = await readEnvFile(envFilePath);
  const headers = buildAuthHeaders(auth, envVars);
  const results: EndpointTestResult[] = [];

  for (const endpoint of testEndpoints) {
    const url = resolveEndpointUrl(endpoint, envVars);
    process.stderr.write(`  Testing ${url} ... `);
    const result = await testSingleEndpoint(url, headers, timeoutMs);
    if (result.status === 'ok') {
      const countInfo =
        result.recordCount !== undefined
          ? ` (${result.recordCount} records)`
          : '';
      process.stderr.write(`OK ${result.statusCode}${countInfo} [${result.durationMs}ms]\n`);
    } else {
      process.stderr.write(`FAILED ${result.error ?? 'unknown'} [${result.durationMs}ms]\n`);
    }
    results.push(result);
  }

  return {
    connectionName,
    results,
    allPassed: results.every((r) => r.status === 'ok'),
  };
}
