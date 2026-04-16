/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { logger } from '../../lib/logger.js';
import { getAdminAgentUrl } from '../../lib/config.js';

const ADMIN_CHAT_TIMEOUT_MS = 300_000;

export const adminChatRoutes = new Hono();

adminChatRoutes.post('/api/studio/admin-chat/stream', async (c) => {
  const adminUrl = getAdminAgentUrl();
  if (!adminUrl) {
    return c.json(
      { error: { code: 'ADMIN_AGENT_NOT_CONFIGURED', message: 'Admin agent not configured' } },
      503,
    );
  }

  const body = await c.req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${adminUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ADMIN_CHAT_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('admin_chat_fetch_error', { error: message });
    return c.json(
      { error: { code: 'ADMIN_AGENT_UNREACHABLE', message: 'Failed to reach admin agent' } },
      502,
    );
  }

  if (!upstream.ok) {
    if (upstream.body) {
      return stream(c, async (s) => {
        const reader = upstream.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await s.write(value);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('admin_chat_upstream_read_error', { error: message });
        }
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status is always valid
    return c.body(null, upstream.status as import('hono/utils/http-status').ContentfulStatusCode);
  }

  c.header('Content-Type', upstream.headers.get('Content-Type') ?? 'text/event-stream');
  c.header('Cache-Control', 'no-cache, no-transform');

  if (upstream.body) {
    return stream(c, async (s) => {
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await s.write(value);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('admin_chat_pump_error', { error: message });
      }
    });
  }

  return c.body(null, 200);
});
