/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getAgentId, getAgentName, getRuntimeUrl } from '../../lib/config.js';

export const configRouter = Router();

configRouter.get('/api/studio/config', asyncHandler(async (_req, res) => {
  res.json({
    agentName: getAgentName(),
    runtimeUrl: getRuntimeUrl(),
    agentId: getAgentId(),
  });
}));
