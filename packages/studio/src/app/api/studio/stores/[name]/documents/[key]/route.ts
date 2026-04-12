/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * API route for fetching a single document and its version history.
 * Called by the DocumentView client component to refetch on real-time events.
 * Queries Postgres directly via store-queries — no runtime API calls.
 */

import { NextResponse } from 'next/server';
import { getDocument, getDocumentHistory } from '@/lib/store-queries';
import { getAgentId } from '@/lib/config';
import { logger } from '@/lib/logger';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string; key: string }> },
): Promise<NextResponse> {
  try {
    const { name, key } = await ctx.params;
    const decodedKey = decodeURIComponent(key);
    const agentId = getAgentId();

    const [document, history] = await Promise.all([
      getDocument(agentId, name, decodedKey),
      getDocumentHistory(agentId, name, decodedKey),
    ]);

    return NextResponse.json({ document, history });
  } catch (err: unknown) {
    logger.error('api_document_detail_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to fetch document' },
      { status: 500 },
    );
  }
}
