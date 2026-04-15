/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { logger } from '../../lib/logger.js';

const RUNTIME_PROXY_TIMEOUT_MS = 5_000;

export const runtimeProxyRouter = Router();

// Proxy the file tree root
runtimeProxyRouter.get('/api/runtime/files', asyncHandler(async (_req, res) => {
  const runtimeUrl = process.env['RUNTIME_URL'];
  if (!runtimeUrl) {
    res.status(503).json({ error: { code: 'RUNTIME_URL_NOT_CONFIGURED', message: 'RUNTIME_URL not configured' } });
    return;
  }

  try {
    const upstream = await fetch(`${runtimeUrl}/api/files`, {
      signal: AbortSignal.timeout(RUNTIME_PROXY_TIMEOUT_MS),
    });
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json');
    const body = await upstream.text();
    res.send(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', { path: '/api/files', error: message });
    res.status(502).json({ error: { code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime' } });
  }
}));

// Proxy file tree with path
runtimeProxyRouter.get('/api/runtime/files/{*filePath}', asyncHandler(async (req, res) => {
  const filePath = String(req.params['filePath'] ?? '');
  const runtimeUrl = process.env['RUNTIME_URL'];
  if (!runtimeUrl) {
    res.status(503).json({ error: { code: 'RUNTIME_URL_NOT_CONFIGURED', message: 'RUNTIME_URL not configured' } });
    return;
  }

  const upstreamPath = filePath ? `/api/files/${filePath}` : '/api/files';

  try {
    const upstream = await fetch(`${runtimeUrl}${upstreamPath}`, {
      signal: AbortSignal.timeout(RUNTIME_PROXY_TIMEOUT_MS),
    });
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json');
    const body = await upstream.text();
    res.send(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('runtime_proxy_error', { path: upstreamPath, error: message });
    res.status(502).json({ error: { code: 'RUNTIME_UNREACHABLE', message: 'Failed to reach runtime' } });
  }
}));
