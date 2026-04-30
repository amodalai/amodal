/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Proxy routes from Studio server to the runtime. The Studio frontend
 * calls these instead of hitting the runtime directly — the runtime URL
 * is a server-side detail, not exposed to the browser.
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { logger } from '../../lib/logger.js';
import { getRuntimeUrl } from '../../lib/config.js';
import { extractWildcard } from './route-utils.js';

const PROXY_TIMEOUT_MS = 10_000;
const LONG_PROXY_TIMEOUT_MS = 300_000; // evals, chat

export const runtimeProxyRoutes = new Hono();

// ---------------------------------------------------------------------------
// Generic proxy helper
// ---------------------------------------------------------------------------

type StatusCode = import('hono/utils/http-status').ContentfulStatusCode;

async function proxyGet(c: Parameters<Parameters<typeof runtimeProxyRoutes.get>[1]>[0], runtimePath: string, timeout = PROXY_TIMEOUT_MS) {
  const runtimeUrl = getRuntimeUrl();
  if (!runtimeUrl) return c.json({error: {code: 'RUNTIME_NOT_CONFIGURED', message: 'RUNTIME_URL not configured'}}, 503);
  try {
    const upstream = await fetch(`${runtimeUrl}${runtimePath}`, {signal: AbortSignal.timeout(timeout)});
    const body = await upstream.text();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status
    return c.text(body, upstream.status as StatusCode, {'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json'});
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', {path: runtimePath, error: message});
    return c.json({error: {code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime'}}, 502);
  }
}

async function proxyPost(c: Parameters<Parameters<typeof runtimeProxyRoutes.post>[1]>[0], runtimePath: string, timeout = PROXY_TIMEOUT_MS) {
  const runtimeUrl = getRuntimeUrl();
  if (!runtimeUrl) return c.json({error: {code: 'RUNTIME_NOT_CONFIGURED', message: 'RUNTIME_URL not configured'}}, 503);
  try {
    const body = await c.req.text();
    const upstream = await fetch(`${runtimeUrl}${runtimePath}`, {
      method: 'POST',
      headers: {'Content-Type': c.req.header('Content-Type') ?? 'application/json'},
      body,
      signal: AbortSignal.timeout(timeout),
    });
    const responseBody = await upstream.text();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status
    return c.text(responseBody, upstream.status as StatusCode, {'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json'});
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', {path: runtimePath, error: message});
    return c.json({error: {code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime'}}, 502);
  }
}

async function proxyPostStream(c: Parameters<Parameters<typeof runtimeProxyRoutes.post>[1]>[0], runtimePath: string) {
  const runtimeUrl = getRuntimeUrl();
  if (!runtimeUrl) return c.json({error: {code: 'RUNTIME_NOT_CONFIGURED', message: 'RUNTIME_URL not configured'}}, 503);
  try {
    const body = await c.req.text();
    const upstream = await fetch(`${runtimeUrl}${runtimePath}`, {
      method: 'POST',
      headers: {'Content-Type': c.req.header('Content-Type') ?? 'application/json'},
      body,
      signal: AbortSignal.timeout(LONG_PROXY_TIMEOUT_MS),
    });
    if (!upstream.ok || !upstream.body) {
      const responseBody = await upstream.text();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status
      return c.text(responseBody, upstream.status as StatusCode, {'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json'});
    }
    c.header('Content-Type', upstream.headers.get('Content-Type') ?? 'text/event-stream');
    c.header('Cache-Control', 'no-cache, no-transform');
    return stream(c, async (s) => {
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          await s.write(value);
        }
      } catch (err: unknown) {
        logger.warn('runtime_proxy_stream_error', {path: runtimePath, error: err instanceof Error ? err.message : String(err)});
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', {path: runtimePath, error: message});
    return c.json({error: {code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime'}}, 502);
  }
}

async function proxyPut(c: Parameters<Parameters<typeof runtimeProxyRoutes.put>[1]>[0], runtimePath: string) {
  const runtimeUrl = getRuntimeUrl();
  if (!runtimeUrl) return c.json({error: {code: 'RUNTIME_NOT_CONFIGURED', message: 'RUNTIME_URL not configured'}}, 503);
  try {
    const body = await c.req.text();
    const upstream = await fetch(`${runtimeUrl}${runtimePath}`, {
      method: 'PUT',
      headers: {'Content-Type': c.req.header('Content-Type') ?? 'text/plain'},
      body,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    const responseBody = await upstream.text();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status
    return c.text(responseBody, upstream.status as StatusCode, {'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json'});
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', {path: runtimePath, error: message});
    return c.json({error: {code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime'}}, 502);
  }
}

// ---------------------------------------------------------------------------
// GET proxies
// ---------------------------------------------------------------------------

runtimeProxyRoutes.get('/api/runtime/files', (c) => proxyGet(c, '/api/files'));
runtimeProxyRoutes.get('/api/runtime/files/*', (c) => {
  const filePath = extractWildcard(c.req.path, '/api/runtime/files/');
  return proxyGet(c, filePath ? `/api/files/${filePath}` : '/api/files');
});
runtimeProxyRoutes.get('/api/runtime/config', (c) => proxyGet(c, '/api/config'));
runtimeProxyRoutes.get('/api/runtime/stats', (c) => proxyGet(c, '/api/stats'));
runtimeProxyRoutes.get('/api/runtime/getting-started', (c) => proxyGet(c, '/api/getting-started'));
runtimeProxyRoutes.get('/api/runtime/connections/:packageName', (c) => proxyGet(c, `/api/connections/${encodeURIComponent(c.req.param('packageName'))}`));
runtimeProxyRoutes.get('/api/runtime/oauth/start', (c) => {
  const qs = new URL(c.req.url).search;
  return proxyGet(c, `/api/oauth/start${qs}`);
});
runtimeProxyRoutes.get('/api/runtime/sessions/history', (c) => proxyGet(c, '/sessions/history'));
runtimeProxyRoutes.get('/api/runtime/inspect/context', (c) => proxyGet(c, '/inspect/context'));
runtimeProxyRoutes.get('/api/runtime/inspect/:kind/:name', (c) => {
  const kind = c.req.param('kind');
  const name = c.req.param('name');
  return proxyGet(c, `/inspect/${kind}/${encodeURIComponent(name)}`);
});

// ---------------------------------------------------------------------------
// POST proxies
// ---------------------------------------------------------------------------

runtimeProxyRoutes.post('/api/runtime/secrets/:name', (c) => proxyPost(c, `/api/secrets/${encodeURIComponent(c.req.param('name'))}`));
runtimeProxyRoutes.post('/api/runtime/evals/run', (c) => proxyPostStream(c, '/api/evals/run'));
runtimeProxyRoutes.post('/api/runtime/chat', (c) => proxyPostStream(c, '/chat'));
runtimeProxyRoutes.post('/api/runtime/chat/stream', (c) => proxyPostStream(c, '/chat/stream'));

// ---------------------------------------------------------------------------
// PUT proxies
// ---------------------------------------------------------------------------

runtimeProxyRoutes.put('/api/runtime/files/*', (c) => {
  const filePath = extractWildcard(c.req.path, '/api/runtime/files/');
  return proxyPut(c, `/api/files/${filePath}`);
});
