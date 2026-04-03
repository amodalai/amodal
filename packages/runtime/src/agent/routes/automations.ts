/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {ProactiveRunner} from '../proactive/proactive-runner.js';

export interface AutomationRouterOptions {
  runner: ProactiveRunner;
}

/**
 * Creates routes for listing, starting, stopping, and triggering automations.
 *
 * GET  /automations              — list all registered automations
 * POST /automations/:name/start  — start a cron automation
 * POST /automations/:name/stop   — stop a running cron automation
 * POST /automations/:name/run    — manually trigger an automation
 */
export function createAutomationRouter(options: AutomationRouterOptions): Router {
  const router = Router();

  router.get('/automations', (_req: Request, res: Response) => {
    const automations = options.runner.listAutomations();
    res.json({automations});
  });

  router.post('/automations/:name/start', (req: Request, res: Response) => {
    const name = req.params['name'] ?? '';
    const result = options.runner.startAutomation(name);
    if (!result.success) {
      res.status(400).json({error: result.error});
      return;
    }
    res.json({status: 'started', automation: name});
  });

  router.post('/automations/:name/stop', (req: Request, res: Response) => {
    const name = req.params['name'] ?? '';
    const result = options.runner.stopAutomation(name);
    if (!result.success) {
      res.status(400).json({error: result.error});
      return;
    }
    res.json({status: 'stopped', automation: name});
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.post('/automations/:name/run', async (req: Request, res: Response) => {
    const name = req.params['name'] ?? '';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express body parsing
    const payload = (req.body ?? {}) as Record<string, unknown>;

    try {
      const result = await options.runner.triggerAutomation(name, payload);
      if (!result.success) {
        res.status(result.error?.toLowerCase().includes('not found') ? 404 : 500).json({status: 'error', automation: name, error: result.error});
        return;
      }
      res.json({status: 'completed', automation: name});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: msg});
    }
  });

  // SSE streaming endpoint for live automation runs
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.post('/automations/:name/stream', async (req: Request, res: Response) => {
    const name = req.params['name'] ?? '';

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      const stream = options.runner.streamAutomation(name);
      if (!stream) {
        res.write(`data: ${JSON.stringify({type: 'error', message: `Automation "${name}" not found`})}\n\n`);
        res.end();
        return;
      }

      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({type: 'error', message: msg})}\n\n`);
    }

    res.write(`data: ${JSON.stringify({type: 'done', timestamp: new Date().toISOString()})}\n\n`);
    res.end();
  });

  return router;
}
