/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { getAuthContext } from '../middleware/auth.js';

export interface SessionsRouterOptions {
  platformApiUrl: string;
}

/**
 * Proxy routes for session history.
 * Forwards to platform-api /api/tenants/{tenantId}/sessions endpoints.
 */
export function createSessionsRouter(options: SessionsRouterOptions): Router {
  const router = Router();

  // List sessions for the authenticated tenant
  router.get('/sessions/history', async (req, res, next) => {
    try {
      const auth = getAuthContext(res);
      if (!auth?.tenantId || !auth.token) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing auth context' } });
        return;
      }

      const tagsParam = req.query['tags'];
      const qs = tagsParam ? `?tags=${String(tagsParam)}` : '';
      const url = `${options.platformApiUrl}/api/tenants/${auth.tenantId}/sessions${qs}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      next(err);
    }
  });

  // Get a single session with full messages
  router.get('/sessions/history/:id', async (req, res, next) => {
    try {
      const auth = getAuthContext(res);
      if (!auth?.tenantId || !auth.token) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing auth context' } });
        return;
      }

      const sessionId = req.params['id'];
      const url = `${options.platformApiUrl}/api/tenants/${auth.tenantId}/sessions/${sessionId}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      next(err);
    }
  });

  // Update session tags/title
  router.patch('/sessions/history/:id', async (req, res, next) => {
    try {
      const auth = getAuthContext(res);
      if (!auth?.tenantId || !auth.token) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing auth context' } });
        return;
      }

      const sessionId = req.params['id'];
      const url = `${options.platformApiUrl}/api/tenants/${auth.tenantId}/sessions/${sessionId}`;

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
