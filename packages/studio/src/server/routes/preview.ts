/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { StudioFeatureUnavailableError } from '../../lib/errors.js';

export const previewRoutes = new Hono();

previewRoutes.post('/api/preview', async () => {
  throw new StudioFeatureUnavailableError(
    'preview',
    'Preview is not available in local development mode. Publish directly instead.',
  );
});
