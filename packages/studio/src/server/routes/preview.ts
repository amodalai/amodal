/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { StudioFeatureUnavailableError } from '../../lib/errors.js';

export const previewRouter = Router();

previewRouter.post('/api/studio/preview', asyncHandler(async (_req, _res) => {
  throw new StudioFeatureUnavailableError(
    'preview',
    'Preview is not available in local development mode. Publish directly instead.',
  );
}));
