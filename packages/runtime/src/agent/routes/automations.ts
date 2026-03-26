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

  router.post('/automations/:name/run', async (req: Request, res: Response) => {
    const name = req.params['name'] ?? '';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express body parsing
    const payload = (req.body ?? {}) as Record<string, unknown>;

    try {
      const result = await options.runner.triggerAutomation(name, payload);
      if (!result.success) {
        res.status(404).json({error: result.error});
        return;
      }
      res.json({status: 'triggered', automation: name});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: msg});
    }
  });

  return router;
}
