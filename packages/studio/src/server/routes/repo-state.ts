/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { getSetupState, markComplete } from '@amodalai/db';

import { getAgentId } from '../../lib/config.js';
import { getStudioDb } from '../../lib/db.js';
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
  const agentId = getAgentId();
  try {
    const db = await getStudioDb();
    const row = await getSetupState(db, agentId, DEFAULT_SCOPE_ID);

    // Auto-recovery: amodal.json on disk + setup_state row exists with
    // completed_at null is the "crashed mid-commit" signature
    // (commit_setup writes the file before marking the DB; a process
    // exit between the two leaves this state). Stamp the row complete
    // here so the IndexPage probe self-heals — without this, the
    // recovery only runs when the user re-opens the chat (which they
    // can't get to without going through this probe first → loop).
    let effectiveRow = row;
    if (hasAmodalJson && row !== null && row.completedAt === null) {
      try {
        const completedAt = await markComplete(db, agentId, DEFAULT_SCOPE_ID);
        if (completedAt) {
          effectiveRow = { ...row, completedAt };
          logger.info('repo_state_auto_recover', { agentId, completedAt: completedAt.toISOString() });
        }
      } catch (err: unknown) {
        logger.warn('repo_state_auto_recover_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setupInProgress = effectiveRow !== null && effectiveRow.completedAt === null;
    // WARN level so the CLI's quiet filter doesn't drop it. Helps
    // diagnose the "setup completes but UI loops back to /setup" case.
    logger.warn('repo_state_probe_DIAG', {
      agentId,
      hasRow: effectiveRow !== null,
      completedAt: effectiveRow?.completedAt ?? null,
      setupInProgress,
      hasAmodalJson,
    });
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
