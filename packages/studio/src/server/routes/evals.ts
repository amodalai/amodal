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
evalsRoutes.get('/api/evals', async (c) => {
  const agentId = c.req.query('agentId') ?? '';
  if (!agentId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'agentId query parameter is required' } }, 400);
  }

  const suites = await listEvalSuites(agentId);
  return c.json({ suites });
});

// Get a single eval suite
evalsRoutes.get('/api/evals/:id', async (c) => {
  const id = c.req.param('id');
  const suite = await getEvalSuite(id);

  if (!suite) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Eval suite not found: ${id}` } }, 404);
  }

  return c.json({ suite });
});

// Run an eval suite
evalsRoutes.post('/api/evals/:id/run', async (c) => {
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
evalsRoutes.get('/api/evals/:id/results', async (c) => {
  const id = c.req.param('id');
  const runs = await listEvalRuns(id);
  return c.json({ runs });
});

// List eval runs by eval suite name (used by arena)
evalsRoutes.get('/api/evals/runs/by-eval/:name', async (c) => {
  const name = c.req.param('name');
  const agentId = c.req.query('agentId') ?? '';
  // Find the suite by name, then list its runs
  const suites = await listEvalSuites(agentId);
  const suite = suites.find((s) => s.name === name);
  if (!suite) {
    return c.json({ runs: [] });
  }
  const runs = await listEvalRuns(suite.id);
  return c.json({ runs });
});

// Arena models — returns available models for arena comparison
evalsRoutes.get('/api/evals/arena/models', async (c) => 
  // TODO: return configured models from agent config
   c.json({ models: [] })
);
