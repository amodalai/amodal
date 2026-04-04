/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
export interface HealthRouterOptions {
  sessionManager: {size: number};
  version?: string;
  startedAt: number;
}

export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime_ms: Date.now() - options.startedAt,
      active_sessions: options.sessionManager.size,
    });
  });

  router.get('/version', (_req, res) => {
    res.json({
      version: options.version ?? 'unknown',
    });
  });

  return router;
}
