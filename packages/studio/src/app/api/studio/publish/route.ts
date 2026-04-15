/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getBackend } from '@/lib/startup';
import { getUser } from '@/lib/auth';
import { handleCors, corsHeaders } from '@/lib/cors';
import { errorResponse } from '@/lib/route-helpers';
import { logger } from '@/lib/logger';

/**
 * POST /api/studio/publish — Publish all drafts.
 * In local dev: writes draft files directly to disk at REPO_PATH.
 * Clears drafts from DB after writing.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const user = await getUser(req);
    const backend = await getBackend(req);

    logger.info('publish_started', { userId: user.userId });
    const result = await backend.publishDrafts(user.userId);
    logger.info('publish_completed', {
      userId: user.userId,
      commitRef: result.commitRef,
      filesPublished: result.filesPublished,
    });

    return NextResponse.json(
      { commitSha: result.commitRef, filesPublished: result.filesPublished },
      { headers: corsHeaders(req) },
    );
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
