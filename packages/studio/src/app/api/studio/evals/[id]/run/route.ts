/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse } from '@/lib/route-helpers';
import { runEvalSuite } from '@/lib/eval-runner';

/**
 * POST /api/studio/evals/[id]/run
 *
 * Trigger an eval suite run. Expects { agentId } in the body.
 * Returns the new run ID.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { id } = await params;

    // System boundary cast — parsing request body
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const body = (await req.json()) as { agentId?: string };
    const agentId = body.agentId;
    if (!agentId) {
      return NextResponse.json(
        { error: { code: 'MISSING_PARAM', message: 'agentId is required in the request body' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    const runId = await runEvalSuite(id, agentId);
    return NextResponse.json({ runId }, { status: 201, headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
