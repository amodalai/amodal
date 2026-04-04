/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { AutomationDefinition } from '@amodalai/core';
import { WebhookPayloadSchema } from '../types.js';
import { validate } from '../middleware/request-validation.js';
import { AppError } from '../middleware/error-handler.js';
import {asyncHandler} from './route-helpers.js';
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

  // Rate-limit inbound webhooks per IP so validation and automation
  // dispatch can't be triggered unboundedly by an attacker.
  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post(
    '/webhooks/:name',
    webhookLimiter,
    validate(WebhookPayloadSchema),
    asyncHandler(async (req, res, next) => {
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
    }),
  );

  return router;
}
