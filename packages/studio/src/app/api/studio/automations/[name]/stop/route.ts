/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse, getAgentId } from '@/lib/route-helpers';
import { getAutomation, setAutomationEnabled } from '@/lib/automation-queries';
import { getScheduler } from '@/lib/automation-scheduler';

interface RouteParams {
  params: Promise<{ name: string }>;
}

/**
 * POST /api/studio/automations/[name]/stop — Disable scheduling for an automation.
 */
export async function POST(req: NextRequest, routeParams: RouteParams): Promise<Response> {
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

    await setAutomationEnabled(agentId, name, false);

    const scheduler = getScheduler(agentId);
    scheduler.disableAutomation(name);

    return NextResponse.json({ ok: true, enabled: false }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
