/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getUser } from '../middleware/auth.js';
import { getBackend } from '../../lib/startup.js';

export const publishRouter = Router();

publishRouter.post('/api/studio/publish', asyncHandler(async (req, res) => {
  const user = await getUser(req);
  const backend = await getBackend();
  const result = await backend.publishDrafts(user.userId);
  res.json(result);
}));
