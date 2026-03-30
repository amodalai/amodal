/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createAutomationRouter} from './automations.js';
import type {ProactiveRunner} from '../proactive/proactive-runner.js';

function makeMockRunner(overrides?: Partial<ProactiveRunner>): ProactiveRunner {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    startAutomation: vi.fn().mockReturnValue({success: true}),
    stopAutomation: vi.fn().mockReturnValue({success: true}),
    listAutomations: vi.fn().mockReturnValue([
      {name: 'daily-check', title: 'Daily Check', schedule: '0 9 * * *', webhookTriggered: false, running: false},
      {name: 'alert-handler', title: 'Alert Handler', webhookTriggered: true, running: true},
    ]),
    handleWebhook: vi.fn().mockResolvedValue({matched: true}),
    triggerAutomation: vi.fn().mockResolvedValue({success: true}),
    ...overrides,
  } as unknown as ProactiveRunner;
}

function createApp(runner: ProactiveRunner): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createAutomationRouter({runner}));
  return app;
}

describe('repo-automations routes', () => {
  it('should list automations with running state', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner);

    const res = await request(app).get('/automations');

    expect(res.status).toBe(200);
    expect(res.body.automations).toHaveLength(2);
    expect(res.body.automations[0].name).toBe('daily-check');
    expect(res.body.automations[0].running).toBe(false);
    expect(res.body.automations[1].running).toBe(true);
  });

  it('should start an automation', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner);

    const res = await request(app).post('/automations/daily-check/start');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('started');
    expect(runner.startAutomation).toHaveBeenCalledWith('daily-check');
  });

  it('should return 400 when start fails', async () => {
    const runner = makeMockRunner({
      startAutomation: vi.fn().mockReturnValue({success: false, error: 'Already running'}),
    } as unknown as Partial<ProactiveRunner>);
    const app = createApp(runner);

    const res = await request(app).post('/automations/daily-check/start');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Already running');
  });

  it('should stop an automation', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner);

    const res = await request(app).post('/automations/daily-check/stop');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');
    expect(runner.stopAutomation).toHaveBeenCalledWith('daily-check');
  });

  it('should return 400 when stop fails', async () => {
    const runner = makeMockRunner({
      stopAutomation: vi.fn().mockReturnValue({success: false, error: 'Not running'}),
    } as unknown as Partial<ProactiveRunner>);
    const app = createApp(runner);

    const res = await request(app).post('/automations/daily-check/stop');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Not running');
  });

  it('should trigger automation manually', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner);

    const res = await request(app)
      .post('/automations/daily-check/run')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(runner.triggerAutomation).toHaveBeenCalledWith('daily-check', {});
  });

  it('should return 404 for unknown automation', async () => {
    const runner = makeMockRunner({
      triggerAutomation: vi.fn().mockResolvedValue({success: false, error: 'Not found'}),
    } as unknown as Partial<ProactiveRunner>);
    const app = createApp(runner);

    const res = await request(app)
      .post('/automations/unknown/run')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Not found');
  });

  it('should pass payload to triggerAutomation', async () => {
    const runner = makeMockRunner();
    const app = createApp(runner);

    await request(app)
      .post('/automations/daily-check/run')
      .send({context: 'manual-trigger'});

    expect(runner.triggerAutomation).toHaveBeenCalledWith('daily-check', {context: 'manual-trigger'});
  });

  it('should handle trigger errors', async () => {
    const runner = makeMockRunner({
      triggerAutomation: vi.fn().mockRejectedValue(new Error('Runtime failure')),
    } as unknown as Partial<ProactiveRunner>);
    const app = createApp(runner);

    const res = await request(app)
      .post('/automations/daily-check/run')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Runtime failure');
  });
});
