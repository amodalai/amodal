/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { getDb, getSetupState } from '@amodalai/db';

import { getAgentId } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

const REPO_PATH_ENV_KEY = 'REPO_PATH';
const AMODAL_JSON = 'amodal.json';
const DEFAULT_SCOPE_ID = '';

/**
 * GET /api/repo-state — minimal "is this repo configured yet?" probe used
 * by Studio to decide between the create flow and the workspace home.
 *
 * Returns:
 *   - `hasAmodalJson`: file exists on disk
 *   - `setupInProgress`: a `setup_state` row exists with `completedAt === null`
 *
 * IndexPage routes to:
 *   - OverviewPage when `hasAmodalJson && !setupInProgress`
 *   - CreateFlowPage otherwise (including the case where `amodal.json`
 *     was vendored by `install_template` mid-flow but `commit_setup`
 *     hasn't run yet — `setupInProgress` keeps us on the chat).
 *
 * Lives on the Studio server (not the runtime) because the runtime can't
 * even start when `amodal.json` is missing — Studio needs a check that
 * works pre-init.
 */
export const repoStateRoutes = new Hono();

repoStateRoutes.get('/api/repo-state', async (c) => {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({ hasAmodalJson: false, setupInProgress: false, repoPath: null });
  }
  const manifestPath = path.join(repoPath, AMODAL_JSON);
  const hasAmodalJson = existsSync(manifestPath);

  let setupInProgress = false;
  try {
    const db = getDb();
    const row = await getSetupState(db, getAgentId(), DEFAULT_SCOPE_ID);
    setupInProgress = row !== null && row.completedAt === null;
  } catch (err: unknown) {
    // If the DB is unreachable, fall through to the disk-only signal.
    // Worst case the user sees the workspace one moment too soon — same
    // behavior as before this check existed.
    logger.debug('repo_state_setup_state_lookup_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return c.json({
    hasAmodalJson,
    setupInProgress,
    repoPath,
  });
});
