/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getUser } from '../middleware/auth.js';
import { getBackend } from '../../lib/startup.js';

export const discardRouter = Router();

discardRouter.post('/api/studio/discard', asyncHandler(async (req, res) => {
  const user = await getUser(req);
  const backend = await getBackend();
  const discarded = await backend.discardAllDrafts(user.userId);
  res.json({ discarded });
}));
