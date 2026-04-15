/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { listFeedback, getFeedbackSummary, markFeedbackReviewed } from '../../lib/feedback-queries.js';

export const feedbackRouter = Router();

// List feedback for an agent
feedbackRouter.get('/api/studio/feedback', asyncHandler(async (req, res) => {
  const agentId = String(req.query['agentId'] ?? '');
  if (!agentId) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'agentId query parameter is required' } });
    return;
  }

  const entries = await listFeedback(agentId);
  res.json(entries);
}));

// Get feedback summary for an agent
feedbackRouter.get('/api/studio/feedback/summary', asyncHandler(async (req, res) => {
  const agentId = String(req.query['agentId'] ?? '');
  if (!agentId) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'agentId query parameter is required' } });
    return;
  }

  const summary = await getFeedbackSummary(agentId);
  res.json(summary);
}));

// Mark feedback entries as reviewed
feedbackRouter.post('/api/studio/feedback/mark-reviewed', asyncHandler(async (req, res) => {
  const body = req.body as unknown;

  if (typeof body !== 'object' || body === null || !('ids' in body)) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body must include "ids" array' } });
    return;
  }

  const { ids } = body as { ids: unknown };
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: '"ids" must be an array of strings' } });
    return;
  }

  await markFeedbackReviewed(ids);
  res.json({ ok: true });
}));
