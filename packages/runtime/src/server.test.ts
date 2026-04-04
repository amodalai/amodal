/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import request from 'supertest';
import {createServer} from './server.js';

describe('createServer', () => {
  let serverInstance: ReturnType<typeof createServer>;

  beforeEach(() => {
    vi.clearAllMocks();

    serverInstance = createServer({
      config: {
        port: 0,
        host: '127.0.0.1',
        sessionTtlMs: 30_000,
        automations: [],
      },
      version: '1.0.0-test',
    });
  });

  afterEach(async () => {
    await serverInstance.stop();
  });

  it('responds to GET /health', async () => {
    const res = await request(serverInstance.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('1.0.0-test');
  });

  it('rejects POST /chat without bundle (no deploy_id)', async () => {
    const res = await request(serverInstance.app)
      .post('/chat')
      .send({message: 'hello'});

    // Without a bundle, session resolution fails
    expect(res.status).toBe(500);
  });

  it('rejects invalid POST /chat request', async () => {
    const res = await request(serverInstance.app)
      .post('/chat')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent routes', async () => {
    const res = await request(serverInstance.app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});
