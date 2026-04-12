/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Proxy route for fetching file tree and file content from the runtime.
 *
 * - GET /api/runtime/files        → proxies to runtime /api/files (tree)
 * - GET /api/runtime/files/{path} → proxies to runtime /api/files/{path} (content)
 *
 * This is the only proxy route in Studio — needed because file selection
 * is a client-side action (user clicks a file in the tree).
 */

import type { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

const RUNTIME_URL_ENV = 'RUNTIME_URL';
const PROXY_TIMEOUT_MS = 5_000;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const filePath = path ? path.join('/') : '';
  const runtimeUrl = process.env[RUNTIME_URL_ENV];

  if (!runtimeUrl) {
    logger.warn('runtime_proxy_no_url', { route: 'files', filePath });
    return new Response(
      JSON.stringify({ error: 'RUNTIME_URL not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const upstreamPath = filePath ? `/api/files/${filePath}` : '/api/files';
  const start = Date.now();

  try {
    const upstream = await fetch(`${runtimeUrl}${upstreamPath}`, {
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    const duration = Date.now() - start;
    logger.debug('runtime_proxy_ok', { route: 'files', filePath, status: upstream.status, duration_ms: duration });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      },
    });
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('runtime_proxy_error', { route: 'files', filePath, error: message, duration_ms: duration });

    return new Response(
      JSON.stringify({ error: 'Runtime unreachable' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
