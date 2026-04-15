/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { listEvalSuites, getEvalSuite, listEvalRuns } from '../../lib/eval-queries.js';
import { runEvalSuite } from '../../lib/eval-runner.js';

export const evalsRouter = Router();

// List all eval suites for an agent
evalsRouter.get('/api/studio/evals', asyncHandler(async (req, res) => {
  const agentId = String(req.query['agentId'] ?? '');
  if (!agentId) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'agentId query parameter is required' } });
    return;
  }

  const suites = await listEvalSuites(agentId);
  res.json(suites);
}));

// Get a single eval suite
evalsRouter.get('/api/studio/evals/:id', asyncHandler(async (req, res) => {
  const id = String(req.params['id'] ?? '');
  const suite = await getEvalSuite(id);

  if (!suite) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Eval suite not found: ${id}` } });
    return;
  }

  res.json(suite);
}));

// Run an eval suite
evalsRouter.post('/api/studio/evals/:id/run', asyncHandler(async (req, res) => {
  const id = String(req.params['id'] ?? '');
  const body = req.body as unknown;

  if (typeof body !== 'object' || body === null || !('agentId' in body)) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body must include "agentId"' } });
    return;
  }

  const agentId = String((body as Record<string, unknown>)['agentId']);
  const runId = await runEvalSuite(id, agentId);
  res.json({ runId });
}));

// List eval runs for a suite
evalsRouter.get('/api/studio/evals/:id/results', asyncHandler(async (req, res) => {
  const id = String(req.params['id'] ?? '');
  const runs = await listEvalRuns(id);
  res.json(runs);
}));
