/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getBackend } from '../../lib/startup.js';

export const workspaceRouter = Router();

workspaceRouter.get('/api/studio/workspace', asyncHandler(async (_req, res) => {
  const backend = await getBackend();
  const workspace = await backend.getWorkspace();
  res.json(workspace);
}));
