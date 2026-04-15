/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getAgentId } from '../../lib/config.js';
import {
  listAutomations,
  getAutomation,
  upsertAutomation,
  setAutomationEnabled,
  listAutomationRuns,
} from '../../lib/automation-queries.js';
import { getScheduler } from '../../lib/automation-scheduler.js';

export const automationsRouter = Router();

// List all automations
automationsRouter.get('/api/studio/automations', asyncHandler(async (_req, res) => {
  const agentId = getAgentId();
  const automations = await listAutomations(agentId);
  res.json({ automations });
}));

// Create or update an automation
automationsRouter.post('/api/studio/automations', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const body = req.body as unknown;

  if (typeof body !== 'object' || body === null) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
  const { name, schedule, message, enabled } = body as Record<string, unknown>;

  if (typeof name !== 'string' || typeof schedule !== 'string' || typeof message !== 'string') {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'name, schedule, and message are required string fields' },
    });
    return;
  }

  await upsertAutomation(agentId, name, {
    schedule,
    message,
    enabled: typeof enabled === 'boolean' ? enabled : undefined,
  });

  res.json({ ok: true });
}));

// Get a single automation with recent runs
automationsRouter.get('/api/studio/automations/:name', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const name = String(req.params['name'] ?? '');

  const [automation, runs] = await Promise.all([
    getAutomation(agentId, name),
    listAutomationRuns(agentId, name),
  ]);

  if (!automation) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Automation not found: ${name}` } });
    return;
  }

  res.json({ automation, runs });
}));

// Trigger an automation run immediately
automationsRouter.post('/api/studio/automations/:name/run', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const name = String(req.params['name'] ?? '');
  const body = req.body as unknown;

  const message = typeof body === 'object' && body !== null && 'message' in body
     
    ? String((body as Record<string, unknown>)['message'])
    : name;

  const scheduler = getScheduler(agentId);
  await scheduler.trigger(name, message);
  res.json({ ok: true });
}));

// Start (enable) an automation
automationsRouter.post('/api/studio/automations/:name/start', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const name = String(req.params['name'] ?? '');

  await setAutomationEnabled(agentId, name, true);

  const automation = await getAutomation(agentId, name);
  if (automation) {
    const scheduler = getScheduler(agentId);
    scheduler.enableAutomation(name, automation.schedule, automation.message);
  }

  res.json({ ok: true });
}));

// Stop (disable) an automation
automationsRouter.post('/api/studio/automations/:name/stop', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const name = String(req.params['name'] ?? '');

  await setAutomationEnabled(agentId, name, false);

  const scheduler = getScheduler(agentId);
  scheduler.disableAutomation(name);

  res.json({ ok: true });
}));
