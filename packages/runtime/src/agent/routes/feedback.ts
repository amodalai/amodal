/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {FeedbackStore} from '../feedback-store.js';

export interface FeedbackRouterOptions {
  feedbackStore: FeedbackStore;
}

export function createFeedbackRouter(options: FeedbackRouterOptions): Router {
  const router = Router();

  /** Save a feedback rating */
  router.post('/api/feedback', (req: Request, res: Response) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = String(body['sessionId'] ?? '');
      const messageId = String(body['messageId'] ?? '');
      const rating = String(body['rating'] ?? '');
      const comment = body['comment'] ? String(body['comment']) : undefined;
      const query = String(body['query'] ?? '');
      const response = String(body['response'] ?? '');
       
      const toolCalls = Array.isArray(body['toolCalls']) ? (body['toolCalls'] as unknown[]).map(String) : undefined;
      const model = body['model'] ? String(body['model']) : undefined;

      if (!sessionId || !messageId) {
        res.status(400).json({error: 'sessionId and messageId are required'});
        return;
      }
      if (rating !== 'up' && rating !== 'down') {
        res.status(400).json({error: 'rating must be "up" or "down"'});
        return;
      }

      const entry = options.feedbackStore.save({
        sessionId,
        messageId,
        rating,
        comment,
        query,
        response: response.slice(0, 2000),
        toolCalls,
        model,
      });

      res.json({ok: true, id: entry.id});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: msg});
    }
  });

  /** List all feedback entries */
  router.get('/api/feedback', (_req: Request, res: Response) => {
    const limit = Number(_req.query['limit']) || 100;
    const entries = options.feedbackStore.list(limit);
    res.json({entries});
  });

  /** Get feedback summary stats */
  router.get('/api/feedback/summary', (_req: Request, res: Response) => {
    const summary = options.feedbackStore.summary();
    res.json(summary);
  });

  return router;
}
