/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { logger } from '../../lib/logger.js';

const ADMIN_CHAT_TIMEOUT_MS = 300_000;

export const adminChatRouter = Router();

adminChatRouter.post('/api/studio/admin-chat/stream', asyncHandler(async (req, res) => {
  const adminUrl = process.env['ADMIN_AGENT_URL'];
  if (!adminUrl) {
    res.status(503).json({
      error: { code: 'ADMIN_AGENT_NOT_CONFIGURED', message: 'Admin agent not configured' },
    });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${adminUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(ADMIN_CHAT_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('admin_chat_fetch_error', { error: message });
    res.status(502).json({
      error: { code: 'ADMIN_AGENT_UNREACHABLE', message: 'Failed to reach admin agent' },
    });
    return;
  }

  if (!upstream.ok) {
    res.status(upstream.status);
    if (upstream.body) {
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('admin_chat_upstream_read_error', { error: message });
      }
      res.end();
    } else {
      res.end();
    }
    return;
  }

  res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  if (upstream.body) {
    const reader = upstream.body.getReader();
    const pump = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };
    pump().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('admin_chat_pump_error', { error: message });
      res.end();
    });
    req.on('close', () => {
      reader.cancel().catch(() => { /* client disconnected */ });
    });
  } else {
    res.end();
  }
}));
