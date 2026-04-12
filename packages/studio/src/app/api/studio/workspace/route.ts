/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getBackend } from '@/lib/startup';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse } from '@/lib/route-helpers';

/**
 * GET /api/studio/workspace — Serve the full file bundle for fetch_workspace.
 *
 * Returns { agentId, files: [{ path, content }, ...] }
 * Reads from the agent's repo path on disk (local dev).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const backend = await getBackend();
    const workspace = await backend.getWorkspace();
    return NextResponse.json(workspace, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
