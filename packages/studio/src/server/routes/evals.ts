/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { listEvalSuites, getEvalSuite, listEvalRuns } from '../../lib/eval-queries.js';
import { runEvalSuite } from '../../lib/eval-runner.js';

export const evalsRoutes = new Hono();

// List all eval suites for an agent
evalsRoutes.get('/api/studio/evals', async (c) => {
  const agentId = c.req.query('agentId') ?? '';
  if (!agentId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'agentId query parameter is required' } }, 400);
  }

  const suites = await listEvalSuites(agentId);
  return c.json({ suites });
});

// Get a single eval suite
evalsRoutes.get('/api/studio/evals/:id', async (c) => {
  const id = c.req.param('id');
  const suite = await getEvalSuite(id);

  if (!suite) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Eval suite not found: ${id}` } }, 404);
  }

  return c.json({ suite });
});

// Run an eval suite
evalsRoutes.post('/api/studio/evals/:id/run', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json() as unknown;

  if (typeof body !== 'object' || body === null || !('agentId' in body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must include "agentId"' } }, 400);
  }

  const agentId = String((body as Record<string, unknown>)['agentId']);
  const runId = await runEvalSuite(id, agentId);
  return c.json({ runId });
});

// List eval runs for a suite
evalsRoutes.get('/api/studio/evals/:id/results', async (c) => {
  const id = c.req.param('id');
  const runs = await listEvalRuns(id);
  return c.json({ runs });
});
