/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse } from '@/lib/route-helpers';
import { markFeedbackReviewed } from '@/lib/feedback-queries';

/**
 * POST /api/studio/feedback/mark-reviewed
 *
 * Mark feedback entries as reviewed. Expects { ids: string[] } in the body.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // System boundary cast — parsing request body
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const body = (await req.json()) as { ids?: string[] };
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: { code: 'MISSING_PARAM', message: 'ids array is required in the request body' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    await markFeedbackReviewed(ids);
    return NextResponse.json({ ok: true }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
