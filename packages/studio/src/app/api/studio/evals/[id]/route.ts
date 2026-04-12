/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse } from '@/lib/route-helpers';
import { getEvalSuite } from '@/lib/eval-queries';

/**
 * GET /api/studio/evals/[id]
 *
 * Get details for a single eval suite.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { id } = await params;
    const suite = await getEvalSuite(id);
    if (!suite) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `Eval suite ${id} not found` } },
        { status: 404, headers: corsHeaders(req) },
      );
    }
    return NextResponse.json({ suite }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
