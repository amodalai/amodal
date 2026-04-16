/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getAgentId } from '../../lib/config.js';
import {
  listAutomations,
  getAutomation,
  upsertAutomation,
  setAutomationEnabled,
  listAutomationRuns,
} from '../../lib/automation-queries.js';
import { getScheduler } from '../../lib/automation-scheduler.js';

export const automationsRoutes = new Hono();

// List all automations
automationsRoutes.get('/api/studio/automations', async (c) => {
  const agentId = getAgentId();
  const automations = await listAutomations(agentId);
  return c.json({ automations });
});

// Create or update an automation
automationsRoutes.post('/api/studio/automations', async (c) => {
  const agentId = getAgentId();
  const body = await c.req.json() as unknown;

  if (typeof body !== 'object' || body === null) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
  const { name, schedule, message, enabled } = body as Record<string, unknown>;

  if (typeof name !== 'string' || typeof schedule !== 'string' || typeof message !== 'string') {
    return c.json({
      error: { code: 'BAD_REQUEST', message: 'name, schedule, and message are required string fields' },
    }, 400);
  }

  await upsertAutomation(agentId, name, {
    schedule,
    message,
    enabled: typeof enabled === 'boolean' ? enabled : undefined,
  });

  return c.json({ ok: true });
});

// Get a single automation with recent runs
automationsRoutes.get('/api/studio/automations/:name', async (c) => {
  const agentId = getAgentId();
  const name = c.req.param('name');

  const [automation, runs] = await Promise.all([
    getAutomation(agentId, name),
    listAutomationRuns(agentId, name),
  ]);

  if (!automation) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Automation not found: ${name}` } }, 404);
  }

  return c.json({ automation, runs });
});

// Trigger an automation run immediately
automationsRoutes.post('/api/studio/automations/:name/run', async (c) => {
  const agentId = getAgentId();
  const name = c.req.param('name');
  const body = await c.req.json() as unknown;

  const message = typeof body === 'object' && body !== null && 'message' in body
    ? String((body as Record<string, unknown>)['message'])
    : name;

  const scheduler = getScheduler(agentId);
  await scheduler.trigger(name, message);
  return c.json({ ok: true });
});

// Start (enable) an automation
automationsRoutes.post('/api/studio/automations/:name/start', async (c) => {
  const agentId = getAgentId();
  const name = c.req.param('name');

  await setAutomationEnabled(agentId, name, true);

  const automation = await getAutomation(agentId, name);
  if (automation) {
    const scheduler = getScheduler(agentId);
    scheduler.enableAutomation(name, automation.schedule, automation.message);
  }

  return c.json({ ok: true });
});

// Stop (disable) an automation
automationsRoutes.post('/api/studio/automations/:name/stop', async (c) => {
  const agentId = getAgentId();
  const name = c.req.param('name');

  await setAutomationEnabled(agentId, name, false);

  const scheduler = getScheduler(agentId);
  scheduler.disableAutomation(name);

  return c.json({ ok: true });
});
