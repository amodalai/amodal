/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError } from './error-handler.js';

function createMockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('errorHandler', () => {
  const req = {} as Request;
  const next = vi.fn() as NextFunction;

  it('returns 500 for generic errors', () => {
    const res = createMockRes();
    errorHandler(new Error('boom'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'boom',
      },
    });
  });

  it('uses statusCode from AppError', () => {
    const res = createMockRes();
    const err = new AppError(404, 'NOT_FOUND', 'Session not found');
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Session not found',
      },
    });
  });

  it('uses status property if present', () => {
    const res = createMockRes();
    const err = Object.assign(new Error('bad'), { status: 400 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('defaults message for empty error', () => {
    const res = createMockRes();
    errorHandler(new Error(''), req, res, next);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });
});

describe('AppError', () => {
  it('sets properties correctly', () => {
    const err = new AppError(422, 'VALIDATION_ERROR', 'bad input');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('bad input');
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });
});
