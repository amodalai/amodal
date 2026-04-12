/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {FeedbackStore} from '../feedback-store.js';
import {asyncHandler} from '../../routes/route-helpers.js';

export interface FeedbackRouterOptions {
  feedbackStore: FeedbackStore;
}

export function createFeedbackRouter(options: FeedbackRouterOptions): Router {
  const router = Router();

  /** Save a feedback rating */
  router.post('/api/feedback', asyncHandler(async (req, res) => {
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

    const entry = await options.feedbackStore.save({
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
  }));

  /** List all feedback entries */
  router.get('/api/feedback', asyncHandler(async (req, res) => {
    const limit = Number(req.query['limit']) || 100;
    const entries = await options.feedbackStore.list(limit);
    res.json({entries});
  }));

  /** Get feedback summary stats */
  router.get('/api/feedback/summary', asyncHandler(async (_req, res) => {
    const summary = await options.feedbackStore.summary();
    res.json(summary);
  }));

  /** Mark feedback entries as reviewed */
  router.post('/api/feedback/mark-reviewed', asyncHandler(async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(body['ids']) ? (body['ids'] as unknown[]).map(String) : [];
    if (ids.length === 0) {
      res.status(400).json({error: 'ids array is required'});
      return;
    }
    await options.feedbackStore.markReviewed(ids);
    res.json({ok: true, reviewed: ids.length});
  }));

  return router;
}
