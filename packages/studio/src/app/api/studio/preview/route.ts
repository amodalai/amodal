/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { NextRequest } from 'next/server';
import { handleCors } from '@/lib/cors';
import { StudioFeatureUnavailableError } from '@/lib/errors';
import { errorResponse } from '@/lib/route-helpers';

/**
 * POST /api/studio/preview — Build a preview snapshot and return a signed token.
 *
 * Phase 1: Returns 501 — preview requires build server infrastructure
 * that is only available in the cloud environment.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  return errorResponse(
    req,
    new StudioFeatureUnavailableError(
      'preview',
      'Preview is not available in local development. Deploy to cloud to use preview.',
    ),
  );
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
