/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { listEvalRuns } from '../../lib/eval-queries.js';
import { runEvalSuite } from '../../lib/eval-runner.js';
import { resolveRuntimeContext } from '../../lib/runtime-client.js';

export const evalsRoutes = new Hono();

// Run an eval by name — resolves runtime URL from JWT or env
evalsRoutes.post('/api/evals/run', async (c) => {
  const body = await c.req.json() as unknown;

  if (typeof body !== 'object' || body === null || !('evalName' in body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must include "evalName"' } }, 400);
  }

  const evalName = String((body as Record<string, unknown>)['evalName']);
  const { runtimeUrl, agentId } = await resolveRuntimeContext(c.req.raw);
  const runId = await runEvalSuite(evalName, runtimeUrl, agentId);
  return c.json({ runId });
});

// List eval runs for a suite (by suiteId = "agentId:evalName")
evalsRoutes.get('/api/evals/runs/by-suite/:suiteId', async (c) => {
  const suiteId = c.req.param('suiteId');
  const runs = await listEvalRuns(suiteId);
  return c.json({ runs });
});

// List eval runs by eval name + agentId
evalsRoutes.get('/api/evals/runs/by-eval/:name', async (c) => {
  const name = c.req.param('name');
  const agentId = c.req.query('agentId') ?? '';
  if (!agentId) {
    return c.json({ runs: [] });
  }
  const suiteId = `${agentId}:${name}`;
  const runs = await listEvalRuns(suiteId);
  return c.json({ runs });
});

// Arena models — returns available models for arena comparison
evalsRoutes.get('/api/evals/arena/models', async (c) =>
  // TODO: return configured models from agent config
   c.json({ models: [] })
);
