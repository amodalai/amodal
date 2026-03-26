/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '../types.js';

/**
 * Express error middleware that returns structured JSON errors.
 * Must be registered with 4 parameters for Express to recognize it as error middleware.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction,
): void {
  const statusCode = getStatusCode(err);
  const code = getErrorCode(err);

  res.status(statusCode).json({
    error: {
      code,
      message: err.message || 'Internal server error',
    },
  });
}

function getStatusCode(err: Error): number {
  if ('statusCode' in err && typeof err.statusCode === 'number') {
    return err.statusCode;
  }
  if ('status' in err && typeof err.status === 'number') {
    return err.status;
  }
  return 500;
}

function getErrorCode(err: Error): string {
  if ('code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return 'INTERNAL_ERROR';
}

/**
 * Application-level error with status code and error code.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
