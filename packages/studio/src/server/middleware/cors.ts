/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:3847';
const CORS_ORIGINS_ENV_KEY = 'STUDIO_CORS_ORIGINS';

export function getAllowedOrigins(): string[] {
  const envValue = process.env[CORS_ORIGINS_ENV_KEY];
  if (!envValue) return [DEFAULT_ALLOWED_ORIGIN];
  return envValue.split(',').map(origin => origin.trim()).filter(Boolean);
}
