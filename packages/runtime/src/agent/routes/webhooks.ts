/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import {verifyHmacSignature} from '../proactive/delivery.js';
import type {ProactiveRunner} from '../proactive/proactive-runner.js';

export interface WebhookRouterOptions {
  runner: ProactiveRunner;
  webhookSecret?: string;
}

/**
 * Creates routes for receiving webhook events from external systems.
 *
 * POST /webhooks/:name — trigger a webhook-based automation
 */
export function createWebhookRouter(options: WebhookRouterOptions): Router {
  const router = Router();

  router.post('/webhooks/:name', async (req: Request, res: Response) => {
    const automationName = req.params['name'] ?? '';

    // HMAC verification
    if (options.webhookSecret) {
      const signature = req.headers['x-amodal-signature'];
      if (typeof signature !== 'string') {
        res.status(401).json({error: 'Missing X-Amodal-Signature header'});
        return;
      }

      const rawBody = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);

      if (!verifyHmacSignature(rawBody, signature, options.webhookSecret)) {
        res.status(401).json({error: 'Invalid webhook signature'});
        return;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express body parsing
    const payload = (req.body ?? {}) as Record<string, unknown>;

    try {
      const result = await options.runner.handleWebhook(automationName, payload);
      if (!result.matched) {
        res.status(404).json({error: result.error});
        return;
      }

      if (result.error) {
        res.status(500).json({error: result.error, matched: true});
        return;
      }

      res.json({status: 'accepted', automation: automationName});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: msg});
    }
  });

  return router;
}
