/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * API route for listing documents in a store.
 * Called by the StoreDocumentList client component to refetch on real-time events.
 * Queries Postgres directly via store-queries — no runtime API calls.
 */

import { NextResponse } from 'next/server';
import { listDocuments } from '@/lib/store-queries';
import { getAgentId } from '@/lib/config';
import { logger } from '@/lib/logger';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  try {
    const { name } = await ctx.params;
    const agentId = getAgentId();
    const documents = await listDocuments(agentId, name);
    return NextResponse.json({ documents });
  } catch (err: unknown) {
    logger.error('api_store_documents_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to list store documents' },
      { status: 500 },
    );
  }
}
