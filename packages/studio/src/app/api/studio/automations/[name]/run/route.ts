/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse, getAgentId } from '@/lib/route-helpers';
import { getAutomation } from '@/lib/automation-queries';
import { getScheduler } from '@/lib/automation-scheduler';

interface RouteParams {
  params: Promise<{ name: string }>;
}

/**
 * POST /api/studio/automations/[name]/run — Trigger an automation run immediately.
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

    const scheduler = getScheduler(agentId);

    // Fire and forget — the scheduler records the run and sends notifications.
    // We attach .catch() to avoid floating promise issues.
    void scheduler.trigger(name, automation.message).catch(() => {
      // Error is already logged and recorded by the scheduler
    });

    return NextResponse.json({ ok: true, message: 'Automation triggered' }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
