/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import type { AutomationDefinition } from '@amodalai/core';
import { WebhookPayloadSchema } from '../types.js';
import { validate } from '../middleware/request-validation.js';
import { AppError } from '../middleware/error-handler.js';
import type {AutomationResult} from '../types.js';

type AutomationRunnerFn = (automation: AutomationDefinition, payload?: Record<string, unknown>) => Promise<AutomationResult>;

export interface WebhookRouterOptions {
  automations: AutomationDefinition[];
  runAutomation: AutomationRunnerFn;
}

export function createWebhookRouter(options: WebhookRouterOptions): Router {
  const router = Router();

  // Build a lookup map: webhook source name → automation definition
  const webhookAutomations = new Map<string, AutomationDefinition>();
  for (const a of options.automations) {
    if (a.trigger.type === 'webhook') {
      webhookAutomations.set(a.name, a);
    }
  }

  router.post(
    '/webhooks/:name',
    validate(WebhookPayloadSchema),
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
    async (req, res, next) => {
      try {
        const { name } = req.params;
        if (!name) {
          throw new AppError(400, 'MISSING_NAME', 'Automation name is required');
        }

        const automation = webhookAutomations.get(name);
        if (!automation) {
          throw new AppError(
            404,
            'AUTOMATION_NOT_FOUND',
            `No webhook automation named "${name}"`,
          );
        }

        // Run automation asynchronously — respond 202 immediately
        const payload = req.body.data;
        void options.runAutomation(automation, payload);

        res.status(202).json({
          accepted: true,
          automation: name,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
