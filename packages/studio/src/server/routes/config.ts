/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';

export const configRouter = Router();

configRouter.get('/api/studio/config', asyncHandler(async (_req, res) => {
  res.json({
    agentName: process.env['AGENT_NAME'] ?? 'default',
    runtimeUrl: process.env['RUNTIME_URL'] ?? '',
    agentId: process.env['AGENT_ID'] ?? 'default',
  });
}));
