/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Request, Response, NextFunction } from 'express';
import { StudioError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof StudioError) {
    logger.error('route_error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      ...err.context,
    });
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...err.context },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error('route_unexpected_error', { message });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
