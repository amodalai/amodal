/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getUser } from '../middleware/auth.js';
import { getBackend } from '../../lib/startup.js';
import { StudioFeatureUnavailableError } from '../../lib/errors.js';
import type { PreviewResult } from '../../lib/types.js';
import type { StudioUser } from '../../lib/types.js';
import type { DraftFile } from '../../lib/types.js';

// ---------------------------------------------------------------------------
// Injectable preview handler
// ---------------------------------------------------------------------------

/**
 * A function that handles the preview flow.
 * Cloud injects its implementation (commit to preview branch via GitHub).
 * OSS default throws — preview is only available in cloud.
 */
export type PreviewHandler = (
  req: Request,
  user: StudioUser,
  drafts: DraftFile[],
) => Promise<PreviewResult>;

const defaultHandler: PreviewHandler = async () => {
  throw new StudioFeatureUnavailableError(
    'preview',
    'Preview is not available in local development mode. Publish directly instead.',
  );
};

let _handler: PreviewHandler = defaultHandler;

/**
 * Inject a custom preview handler. Called by cloud-studio at startup.
 */
export function setPreviewHandler(handler: PreviewHandler): void {
  _handler = handler;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const previewRoutes = new Hono();

previewRoutes.post('/api/preview', async (c) => {
  const user = await getUser(c.req.raw);
  const backend = await getBackend(c.req.raw);
  const drafts = await backend.listDrafts(user.userId);

  if (drafts.length === 0) {
    return c.json({ error: { code: 'NO_DRAFTS', message: 'No drafts to preview' } }, 400);
  }

  const result = await _handler(c.req.raw, user, drafts);
  return c.json(result);
});
