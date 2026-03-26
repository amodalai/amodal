/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from './request-validation.js';
import { AppError } from './error-handler.js';

const TestSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().positive().optional(),
});

function callValidate(
  body: unknown,
): { nextArg: unknown; req: Partial<Request> } {
  const middleware = validate(TestSchema);
  const req: Partial<Request> = { body };
  const res = {} as Response;
  let nextArg: unknown = undefined;
  const next: NextFunction = (arg?: unknown) => {
    nextArg = arg;
  };
  middleware(req as Request, res, next);
  return { nextArg, req };
}

describe('validate middleware', () => {
  it('passes valid body through and replaces req.body with parsed data', () => {
    const { nextArg, req } = callValidate({ name: 'test', count: 5 });
    expect(nextArg).toBeUndefined(); // next() called without error
    expect(req.body).toEqual({ name: 'test', count: 5 });
  });

  it('strips unknown fields from body', () => {
    const { nextArg, req } = callValidate({
      name: 'test',
      extra: 'dropped',
    });
    expect(nextArg).toBeUndefined();
    expect(req.body).toEqual({ name: 'test' });
  });

  it('rejects invalid body with AppError', () => {
    const { nextArg } = callValidate({ count: -1 });
    expect(nextArg).toBeInstanceOf(AppError);
    const err = nextArg as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('name');
  });

  it('reports multiple validation errors', () => {
    const { nextArg } = callValidate({});
    const err = nextArg as AppError;
    expect(err.message).toContain('name');
  });

  it('rejects wrong types', () => {
    const { nextArg } = callValidate({ name: 123 });
    expect(nextArg).toBeInstanceOf(AppError);
  });
});
