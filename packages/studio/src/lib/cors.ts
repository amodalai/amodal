/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:3847';
const CORS_ORIGINS_ENV_KEY = 'STUDIO_CORS_ORIGINS';

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getAllowedOrigins(): string[] {
  const envValue = process.env[CORS_ORIGINS_ENV_KEY];
  if (!envValue) {
    return [DEFAULT_ALLOWED_ORIGIN];
  }
  return envValue.split(',').map(origin => origin.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// CORS handler
// ---------------------------------------------------------------------------

/**
 * Handle CORS for a Next.js API route.
 *
 * For preflight (OPTIONS) requests, pass `isPreflight: true` to return
 * a 204 response with CORS headers.
 *
 * For regular requests, returns `null` if the origin is allowed (headers
 * will be added to the actual response via `corsHeaders()`), or a 403
 * Response if the origin is not allowed.
 */
export function handleCors(req: NextRequest, isPreflight?: boolean): Response | null {
  const origin = req.headers.get('origin');

  // No origin header means same-origin or non-browser request — allow
  if (!origin) {
    if (isPreflight) {
      return new Response(null, { status: 204 });
    }
    return null;
  }

  const allowedOrigins = getAllowedOrigins();
  const isAllowed = allowedOrigins.includes(origin);

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (isPreflight) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Origin is allowed — caller will add headers via corsHeaders()
  return null;
}

/**
 * Get CORS headers to attach to a response for the given request.
 * Returns an empty object if no Origin header is present.
 */
export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};

  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.includes(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  };
}
