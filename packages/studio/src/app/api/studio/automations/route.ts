/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse, getAgentId } from '@/lib/route-helpers';
import { listAutomations, upsertAutomation } from '@/lib/automation-queries';

/**
 * GET /api/studio/automations — List all automations for the current agent.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const agentId = getAgentId();
    const automations = await listAutomations(agentId);
    return NextResponse.json({ automations }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

/**
 * POST /api/studio/automations — Create or update an automation.
 * Body: { name: string, schedule: string, message: string, enabled?: boolean }
 */
export async function POST(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const agentId = getAgentId();
    const body: unknown = await req.json();

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    const name = 'name' in body ? body.name : undefined;
    const schedule = 'schedule' in body ? body.schedule : undefined;
    const message = 'message' in body ? body.message : undefined;
    const enabled = 'enabled' in body ? body.enabled : undefined;

    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '"name" is required and must be a non-empty string' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    if (typeof schedule !== 'string' || !schedule.trim()) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '"schedule" is required and must be a non-empty string' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '"message" is required and must be a non-empty string' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    await upsertAutomation(agentId, name.trim(), {
      schedule: schedule.trim(),
      message: message.trim(),
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
    });

    return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
