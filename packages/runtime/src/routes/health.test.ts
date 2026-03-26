/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.js';

function createApp() {
  const app = express();
  const sessionManager = { size: 3 };
  app.use(
    createHealthRouter({
      sessionManager: sessionManager as never,
      version: '1.0.0',
      startedAt: Date.now() - 5000,
    }),
  );
  return app;
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.active_sessions).toBe(3);
    expect(res.body.uptime_ms).toBeGreaterThan(0);
  });
});

describe('GET /version', () => {
  it('returns 200 with version', async () => {
    const res = await request(createApp()).get('/version');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1.0.0');
  });

  it('returns unknown when no version provided', async () => {
    const app = express();
    app.use(
      createHealthRouter({
        sessionManager: { size: 0 } as never,
        startedAt: Date.now(),
      }),
    );
    const res = await request(app).get('/version');
    expect(res.body.version).toBe('unknown');
  });
});
