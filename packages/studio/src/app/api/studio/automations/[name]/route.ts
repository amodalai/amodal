/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse, getAgentId } from '@/lib/route-helpers';
import { getAutomation, listAutomationRuns } from '@/lib/automation-queries';

interface RouteParams {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/studio/automations/[name] — Get automation detail + recent runs.
 */
export async function GET(req: NextRequest, routeParams: RouteParams): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const agentId = getAgentId();
    const { name } = await routeParams.params;

    const automation = await getAutomation(agentId, name);
    if (!automation) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `Automation not found: ${name}` } },
        { status: 404, headers: corsHeaders(req) },
      );
    }

    const runs = await listAutomationRuns(agentId, name);
    return NextResponse.json({ automation, runs }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
