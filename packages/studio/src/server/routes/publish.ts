/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getUser } from '../middleware/auth.js';
import { getBackend } from '../../lib/startup.js';

export const publishRoutes = new Hono();

publishRoutes.post('/api/studio/publish', async (c) => {
  const user = await getUser(c.req.raw);
  const backend = await getBackend();
  const result = await backend.publishDrafts(user.userId);
  return c.json(result);
});
