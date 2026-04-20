/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { logger } from '../../lib/logger.js';
import { getRuntimeUrl } from '../../lib/config.js';
import { extractWildcard } from './route-utils.js';

const RUNTIME_PROXY_TIMEOUT_MS = 5_000;

export const runtimeProxyRoutes = new Hono();

// Proxy the file tree root
runtimeProxyRoutes.get('/api/runtime/files', async (c) => {
  const runtimeUrl = getRuntimeUrl();
  if (!runtimeUrl) {
    return c.json({ error: { code: 'RUNTIME_URL_NOT_CONFIGURED', message: 'RUNTIME_URL not configured' } }, 503);
  }

  try {
    const upstream = await fetch(`${runtimeUrl}/api/files`, {
      signal: AbortSignal.timeout(RUNTIME_PROXY_TIMEOUT_MS),
    });
    const body = await upstream.text();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status is always valid
    return c.text(body, upstream.status as import('hono/utils/http-status').ContentfulStatusCode, {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', { path: '/api/files', error: message });
    return c.json({ error: { code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime' } }, 502);
  }
});

// Proxy file tree with path
runtimeProxyRoutes.get('/api/runtime/files/*', async (c) => {
  const filePath = extractWildcard(c.req.path, '/api/runtime/files/');
  const runtimeUrl = getRuntimeUrl();
  if (!runtimeUrl) {
    return c.json({ error: { code: 'RUNTIME_URL_NOT_CONFIGURED', message: 'RUNTIME_URL not configured' } }, 503);
  }

  const upstreamPath = filePath ? `/api/files/${filePath}` : '/api/files';

  try {
    const upstream = await fetch(`${runtimeUrl}${upstreamPath}`, {
      signal: AbortSignal.timeout(RUNTIME_PROXY_TIMEOUT_MS),
    });
    const body = await upstream.text();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status is always valid
    return c.text(body, upstream.status as import('hono/utils/http-status').ContentfulStatusCode, {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', { path: upstreamPath, error: message });
    return c.json({ error: { code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime' } }, 502);
  }
});
