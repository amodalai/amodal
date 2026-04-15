/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Request, Response, NextFunction } from 'express';

const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:3847';
const CORS_ORIGINS_ENV_KEY = 'STUDIO_CORS_ORIGINS';
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';

function getAllowedOrigins(): string[] {
  const envValue = process.env[CORS_ORIGINS_ENV_KEY];
  if (!envValue) return [DEFAULT_ALLOWED_ORIGIN];
  return envValue.split(',').map(origin => origin.trim()).filter(Boolean);
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin) { next(); return; }

  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }

  next();
}
