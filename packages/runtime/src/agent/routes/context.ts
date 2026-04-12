/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/context
 *
 * Returns runtime context that the SPA needs to locate external services
 * (Studio, admin agent). The URLs are resolved at server startup from
 * LocalServerConfig, which reads them from environment variables at the
 * boundary — business logic never touches process.env directly.
 */

import {Router} from 'express';

// ---------------------------------------------------------------------------
// Route path constant
// ---------------------------------------------------------------------------

export const CONTEXT_ROUTE = '/api/context' as const;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface ContextResponse {
  studioUrl: string | null;
  adminAgentUrl: string | null;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export interface ContextRouterOptions {
  studioUrl: string | null;
  adminAgentUrl: string | null;
}

export function createContextRouter(options: ContextRouterOptions): Router {
  const router = Router();

  const payload: ContextResponse = {
    studioUrl: options.studioUrl,
    adminAgentUrl: options.adminAgentUrl,
  };

  router.get(CONTEXT_ROUTE, (_req, res) => {
    res.json(payload);
  });

  return router;
}
