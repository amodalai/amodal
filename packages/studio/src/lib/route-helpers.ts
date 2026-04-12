/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { StudioError } from './errors';
import { corsHeaders } from './cors';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const AGENT_ID_ENV_KEY = 'AGENT_NAME';
const DEFAULT_AGENT_ID = 'default';

/**
 * Get the agent ID from the environment. Falls back to 'default' if unset.
 * Used by automation and other agent-scoped routes.
 */
export function getAgentId(): string {
  return process.env[AGENT_ID_ENV_KEY] ?? DEFAULT_AGENT_ID;
}

/**
 * Maps a StudioError (or unknown error) to an appropriate HTTP response.
 * This is the error boundary for all API routes.
 */
export function errorResponse(req: NextRequest, err: unknown): Response {
  if (err instanceof StudioError) {
    logger.error('route_error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      ...err.context,
    });
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...err.context } },
      { status: err.statusCode, headers: corsHeaders(req) },
    );
  }

  // Unknown error — log full details but return generic 500
  const message = err instanceof Error ? err.message : String(err);
  logger.error('route_unexpected_error', { message });
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    { status: 500, headers: corsHeaders(req) },
  );
}
