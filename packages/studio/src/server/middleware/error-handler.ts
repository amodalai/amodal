/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { StudioError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export function handleError(err: Error, c: Context): Response {
  if (err instanceof StudioError) {
    logger.error('route_error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      ...err.context,
    });
    return c.json(
      { error: { code: err.code, message: err.message, ...err.context } },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- StudioError.statusCode is always a valid HTTP status
      err.statusCode as ContentfulStatusCode,
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error('route_unexpected_error', { message });
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    500,
  );
}
