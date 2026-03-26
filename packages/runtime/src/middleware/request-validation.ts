/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import { AppError } from './error-handler.js';

/**
 * Express middleware factory that validates request body against a Zod schema.
 * On success, replaces `req.body` with the parsed (and typed) result.
 * On failure, passes an AppError to the next error handler.
 */
export function validate<T extends z.ZodType>(
  schema: T,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      next(new AppError(400, 'VALIDATION_ERROR', messages));
      return;
    }
    req.body = result.data;
    next();
  };
}
