/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import type { SessionManager } from '../session/session-manager.js';

export interface HealthRouterOptions {
  sessionManager: SessionManager;
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
