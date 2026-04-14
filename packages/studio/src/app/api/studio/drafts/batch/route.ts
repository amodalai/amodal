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
import type { BatchChangeAction } from '@/lib/types';
import { logger } from '@/lib/logger';

function isValidAction(action: unknown): action is BatchChangeAction {
  return action === 'upsert' || action === 'delete';
}

function getStringProp(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === 'string' ? val : undefined;
}

/**
 * POST /api/studio/drafts/batch — Apply multiple draft changes in one request.
 * Body: { changes: [{ path, action, content? }, ...] }
 */
export async function POST(req: NextRequest): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const user = await getUser(req);
    const backend = await getBackend(req);
    const body: unknown = await req.json();

    // Validate request shape
    if (typeof body !== 'object' || body === null || !('changes' in body)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Request body must have a "changes" array' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    // After the 'changes' in body narrowing, we know body has 'changes'
    const { changes } = body;
    if (!Array.isArray(changes)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '"changes" must be an array' } },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    let accepted = 0;

    for (const rawChange of changes) {
      if (typeof rawChange !== 'object' || rawChange === null) {
        return NextResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'Each change must be an object' } },
          { status: 400, headers: corsHeaders(req) },
        );
      }

      // Narrow through property checks
      const change = rawChange as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
      const changePath = getStringProp(change, 'path');
      const changeAction = change['action'];

      if (!changePath || !isValidAction(changeAction)) {
        return NextResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'Each change must have "path" (string) and "action" ("upsert" | "delete")' } },
          { status: 400, headers: corsHeaders(req) },
        );
      }

      const validatedPath = validateDraftPath(changePath);
      const content = getStringProp(change, 'content');

      switch (changeAction) {
        case 'upsert': {
          if (content === undefined) {
            return NextResponse.json(
              { error: { code: 'BAD_REQUEST', message: `"content" is required for upsert action on path "${validatedPath}"` } },
              { status: 400, headers: corsHeaders(req) },
            );
          }
          await backend.saveDraft(user.userId, validatedPath, content);
          accepted++;
          break;
        }
        case 'delete': {
          await backend.deleteDraft(user.userId, validatedPath);
          accepted++;
          break;
        }
        default: {
          // Exhaustive check
          const _exhaustive: never = changeAction;
          return _exhaustive;
        }
      }
    }

    logger.info('batch_changes_applied', { userId: user.userId, accepted });
    return NextResponse.json({ accepted }, { headers: corsHeaders(req) });
  } catch (err: unknown) {
    return errorResponse(req, err);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return handleCors(req, true) ?? new Response(null, { status: 204 });
}
