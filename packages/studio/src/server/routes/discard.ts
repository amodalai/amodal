/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getUser } from '../middleware/auth.js';
import { getBackend } from '../../lib/startup.js';

export const discardRoutes = new Hono();

discardRoutes.post('/api/studio/discard', async (c) => {
  const user = await getUser(c.req.raw);
  const backend = await getBackend();
  const discarded = await backend.discardAllDrafts(user.userId);
  return c.json({ discarded });
});
