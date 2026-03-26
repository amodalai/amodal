/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createHmac} from 'node:crypto';
import {createWebhookRouter} from './webhooks.js';
import type {ProactiveRunner} from '../proactive/proactive-runner.js';

function makeMockRunner(overrides?: Partial<ProactiveRunner>): ProactiveRunner {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    listAutomations: vi.fn().mockReturnValue([]),
    handleWebhook: vi.fn().mockResolvedValue({matched: true}),
    triggerAutomation: vi.fn().mockResolvedValue({success: true}),
    ...overrides,
  } as unknown as ProactiveRunner;
}

function createApp(runner: ProactiveRunner, webhookSecret?: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createWebhookRouter({runner, webhookSecret}));
  return app;
}

describe('repo-webhooks routes', () => {
  it('should accept valid webhook', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner);

    const res = await request(app)
      .post('/webhooks/my-auto')
      .send({alert: 'cpu-high'});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(runner.handleWebhook).toHaveBeenCalledWith('my-auto', {alert: 'cpu-high'});
  });

  it('should return 404 for unmatched automation', async () => {
    const runner = makeMockRunner({
      handleWebhook: vi.fn().mockResolvedValue({matched: false, error: 'Not found'}),
    } as unknown as Partial<ProactiveRunner>);
    const app = createApp(runner);

    const res = await request(app)
      .post('/webhooks/unknown')
      .send({});

    expect(res.status).toBe(404);
  });

  it('should return 500 on automation error', async () => {
    const runner = makeMockRunner({
      handleWebhook: vi.fn().mockResolvedValue({matched: true, error: 'Exec failed'}),
    } as unknown as Partial<ProactiveRunner>);
    const app = createApp(runner);

    const res = await request(app)
      .post('/webhooks/my-auto')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Exec failed');
  });

  it('should verify HMAC signature when secret is set', async () => {
    const runner = makeMockRunner();
    const secret = 'my-secret';
    const app = createApp(runner, secret);
    const body = JSON.stringify({alert: 'test'});
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    const res = await request(app)
      .post('/webhooks/my-auto')
      .set('Content-Type', 'application/json')
      .set('X-Amodal-Signature', sig)
      .send(body);

    expect(res.status).toBe(200);
  });

  it('should reject missing signature when secret is set', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner, 'my-secret');

    const res = await request(app)
      .post('/webhooks/my-auto')
      .send({alert: 'test'});

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing');
  });

  it('should reject invalid signature', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner, 'my-secret');

    const res = await request(app)
      .post('/webhooks/my-auto')
      .set('X-Amodal-Signature', 'sha256=invalid')
      .send({alert: 'test'});

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid');
  });

  it('should not require signature when no secret configured', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner);

    const res = await request(app)
      .post('/webhooks/my-auto')
      .send({});

    expect(res.status).toBe(200);
  });
});
