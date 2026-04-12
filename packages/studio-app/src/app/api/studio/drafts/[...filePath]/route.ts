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
import { validateDraftPath } from '@/lib/draft-path';
import { errorResponse } from '@/lib/route-helpers';

interface RouteParams {
  params: Promise<{ filePath: string[] }>;
}

/**
 * Extract and validate the file path from the catch-all route params.
 */
async function extractFilePath(routeParams: RouteParams): Promise<string> {
  const { filePath } = await routeParams.params;
  const rawPath = filePath.join('/');
  return validateDraftPath(rawPath);
}

/**
 * GET /api/studio/drafts/[...filePath] — Read a single draft file.
 */
export async function GET(req: NextRequest, routeParams: RouteParams): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const validatedPath = await extractFilePath(routeParams);
    const user = await getUser(req);
    const backend = await getBackend();
    const draft = await backend.readDraft(user.userId, validatedPath);

    if (!draft) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `Draft not found: ${validatedPath}` } },
        { status: 404, headers: corsHeaders(req) },
      );
    }

    return NextResponse.json({ draft }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

/**
 * PUT /api/studio/drafts/[...filePath] — Save (upsert) a draft file.
 * Accepts JSON body { content: string } or text/plain body.
 */
export async function PUT(req: NextRequest, routeParams: RouteParams): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const validatedPath = await extractFilePath(routeParams);
    const user = await getUser(req);
    const backend = await getBackend();

    let content: string;
    const contentType = req.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const body: unknown = await req.json();
      if (typeof body !== 'object' || body === null || !('content' in body)) {
        return NextResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'JSON body must have a "content" field' } },
          { status: 400, headers: corsHeaders(req) },
        );
      }
      // After 'content' in body check, TS narrows to { content: unknown }
      const contentField = body.content;
      if (typeof contentField !== 'string') {
        return NextResponse.json(
          { error: { code: 'BAD_REQUEST', message: '"content" field must be a string' } },
          { status: 400, headers: corsHeaders(req) },
        );
      }
      content = contentField;
    } else {
      content = await req.text();
    }

    await backend.saveDraft(user.userId, validatedPath, content);
    return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

/**
 * DELETE /api/studio/drafts/[...filePath] — Revert (delete) a single draft file.
 */
export async function DELETE(req: NextRequest, routeParams: RouteParams): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const validatedPath = await extractFilePath(routeParams);
    const user = await getUser(req);
    const backend = await getBackend();
    await backend.deleteDraft(user.userId, validatedPath);
    return NextResponse.json({ ok: true }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
