/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse } from '@/lib/route-helpers';
import { listFeedback } from '@/lib/feedback-queries';

/**
 * GET /api/studio/feedback?agentId=...
 *
 * List feedback entries for the given agent.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const agentId = req.nextUrl.searchParams.get('agentId');
    if (!agentId) {
      return NextResponse.json(
        { error: { code: 'MISSING_PARAM', message: 'agentId query parameter is required' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    const entries = await listFeedback(agentId);
    return NextResponse.json({ entries }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
