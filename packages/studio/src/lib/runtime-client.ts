/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-side HTTP client for fetching data from the runtime
 * that isn't stored in Postgres (file tree, prompt context, system info).
 */

import { logger } from './logger';

const RUNTIME_URL_ENV = 'RUNTIME_URL';
const AGENT_ID_ENV = 'AGENT_ID';
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Error thrown when a runtime API call returns a non-OK status.
 */
export class RuntimeFetchError extends Error {
  readonly path: string;
  readonly status: number;

  constructor(path: string, status: number) {
    super(`Runtime API returned ${status} for ${path}`);
    this.name = 'RuntimeFetchError';
    this.path = path;
    this.status = status;
  }
}

/**
 * Get the configured runtime base URL from env, or throw if not set.
 */
export function getRuntimeUrl(): string {
  const url = process.env[RUNTIME_URL_ENV];
  if (!url) throw new Error(`${RUNTIME_URL_ENV} is not configured`);
  return url;
}

// ---------------------------------------------------------------------------
// Runtime resolver — injectable hook for cloud deployments
// ---------------------------------------------------------------------------

export interface ResolvedRuntime {
  runtimeUrl: string;
  agentId: string;
}

/**
 * A function that resolves the runtime URL and agent ID from a request.
 * Cloud deployments inject their own implementation (e.g. JWT → platform API).
 */
export type RuntimeResolver = (req: Request) => Promise<ResolvedRuntime>;

/** Default resolver: reads from env vars. */
const defaultResolver: RuntimeResolver = async () => ({
  runtimeUrl: getRuntimeUrl(),
  agentId: process.env[AGENT_ID_ENV] ?? 'default',
});

let _resolver: RuntimeResolver = defaultResolver;

/**
 * Inject a custom runtime resolver. Called by cloud-studio at startup
 * to resolve runtime URL from the JWT via the platform API.
 */
export function setRuntimeResolver(resolver: RuntimeResolver): void {
  _resolver = resolver;
}

/**
 * Resolve the runtime URL and agent ID for a request.
 * Delegates to the registered resolver (default: env vars).
 */
export async function resolveRuntimeContext(req: Request): Promise<ResolvedRuntime> {
  return _resolver(req);
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch JSON data from the runtime API.
 *
 * Uses AbortSignal.timeout to ensure we never hang on a broken
 * runtime process. Logs request duration on both success and failure.
 */
export async function fetchFromRuntime<T>(path: string): Promise<T> {
  const base = getRuntimeUrl();
  const url = `${base}${path}`;
  const start = Date.now();

  const res = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    next: { revalidate: 0 },
  } as RequestInit);

  const duration = Date.now() - start;

  if (!res.ok) {
    logger.warn('runtime_fetch_failed', { path, status: res.status, duration_ms: duration });
    throw new RuntimeFetchError(path, res.status);
  }

  logger.debug('runtime_fetch_ok', { path, status: res.status, duration_ms: duration });
  // The caller defines T and is responsible for ensuring the runtime
  // API returns a compatible shape. This is a system boundary cast.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const data: T = (await res.json()) as T;
  return data;
}
