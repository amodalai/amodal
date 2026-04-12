/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * POST /api/studio/admin-chat/stream — Proxy SSE from the admin agent.
 *
 * Studio proxies the request to avoid cross-origin issues between the
 * Studio UI and the admin agent process.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const adminUrl = process.env['ADMIN_AGENT_URL'];
  if (!adminUrl) {
    logger.warn('admin_chat_proxy_unavailable', { reason: 'ADMIN_AGENT_URL not set' });
    return NextResponse.json(
      { error: { code: 'ADMIN_AGENT_NOT_CONFIGURED', message: 'Admin agent not configured' } },
      { status: 503 },
    );
  }

  const upstreamUrl = `${adminUrl}/chat/stream`;
  logger.info('admin_chat_proxy_start', { upstream: upstreamUrl });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: req.body,
      signal: req.signal,
      // @ts-expect-error — duplex needed for streaming request body in Node fetch
      duplex: 'half',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('admin_chat_proxy_fetch_error', { upstream: upstreamUrl, message });
    return NextResponse.json(
      { error: { code: 'ADMIN_AGENT_UNREACHABLE', message: 'Could not reach admin agent' } },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    logger.error('admin_chat_proxy_upstream_error', {
      upstream: upstreamUrl,
      status: upstream.status,
    });
    return new Response(upstream.body, { status: upstream.status });
  }

  logger.info('admin_chat_proxy_streaming', { status: upstream.status });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
