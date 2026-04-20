/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { listFeedback, getFeedbackSummary, markFeedbackReviewed } from '../../lib/feedback-queries.js';

export const feedbackRoutes = new Hono();

// List feedback for an agent
feedbackRoutes.get('/api/feedback', async (c) => {
  const agentId = c.req.query('agentId') ?? '';
  if (!agentId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'agentId query parameter is required' } }, 400);
  }

  const entries = await listFeedback(agentId);
  return c.json({ entries });
});

// Get feedback summary for an agent
feedbackRoutes.get('/api/feedback/summary', async (c) => {
  const agentId = c.req.query('agentId') ?? '';
  if (!agentId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'agentId query parameter is required' } }, 400);
  }

  const summary = await getFeedbackSummary(agentId);
  return c.json({ summary });
});

// Mark feedback entries as reviewed
feedbackRoutes.post('/api/feedback/mark-reviewed', async (c) => {
  const body = await c.req.json() as unknown;

  if (typeof body !== 'object' || body === null || !('ids' in body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must include "ids" array' } }, 400);
  }

  const { ids } = body as { ids: unknown };
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: '"ids" must be an array of strings' } }, 400);
  }

  await markFeedbackReviewed(ids);
  return c.json({ ok: true });
});
