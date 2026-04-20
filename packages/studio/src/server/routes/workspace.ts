/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getBackend } from '../../lib/startup.js';

export const workspaceRoutes = new Hono();

workspaceRoutes.get('/api/workspace', async (c) => {
  const backend = await getBackend();
  const workspace = await backend.getWorkspace();
  return c.json(workspace);
});
