/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const REPO_PATH_ENV_KEY = 'REPO_PATH';
const AMODAL_JSON = 'amodal.json';

/**
 * GET /api/repo-state — minimal "is this repo configured yet?" probe used
 * by Studio to decide between the create flow and the workspace home.
 *
 * Lives on the Studio server (not the runtime) because the runtime can't
 * even start when `amodal.json` is missing — Studio needs a check that
 * works pre-init.
 */
export const repoStateRoutes = new Hono();

repoStateRoutes.get('/api/repo-state', async (c) => {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({ hasAmodalJson: false, repoPath: null });
  }
  const manifestPath = path.join(repoPath, AMODAL_JSON);
  return c.json({
    hasAmodalJson: existsSync(manifestPath),
    repoPath,
  });
});
