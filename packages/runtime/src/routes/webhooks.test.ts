/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWebhookRouter } from './webhooks.js';
import { errorHandler } from '../middleware/error-handler.js';
import type { AutomationDefinition } from '@amodalai/core';

function makeAutomation(
  name: string,
  triggerType: 'cron' | 'webhook' = 'webhook',
): AutomationDefinition {
  return {
    name,
    trigger:
      triggerType === 'cron'
        ? { type: 'cron', schedule: '*/5 * * * *' }
        : { type: 'webhook', source: name },
    prompt: `Handle ${name}`,
    tools: ['tool1'],
    skills: ['*'],
    output: { channel: 'slack', target: 'https://hooks.slack.com/abc' },
    allow_writes: false,
  };
}

describe('POST /webhooks/:name', () => {
  let mockRunAutomation: ReturnType<typeof vi.fn>;
  let automations: AutomationDefinition[];

  beforeEach(() => {
    mockRunAutomation = vi.fn().mockResolvedValue({
      automation: 'test-webhook',
      response: 'done',
      tool_calls: [],
      output_sent: true,
      duration_ms: 100,
    });
    automations = [
      makeAutomation('test-webhook', 'webhook'),
      makeAutomation('cron-only', 'cron'),
    ];
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use(
      createWebhookRouter({
        automations,
        runAutomation: mockRunAutomation,
      }),
    );
    app.use(errorHandler);
    return app;
  }

  it('accepts a known webhook automation with 202', async () => {
    const res = await request(createApp())
      .post('/webhooks/test-webhook')
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.automation).toBe('test-webhook');
    expect(mockRunAutomation).toHaveBeenCalledOnce();
  });

  it('passes payload data to automation runner', async () => {
    await request(createApp())
      .post('/webhooks/test-webhook')
      .send({ data: { device_id: '42' } });

    const callArgs = mockRunAutomation.mock.calls[0] as unknown[];
    expect(callArgs[1]).toEqual({ device_id: '42' });
  });

  it('returns 404 for unknown automation name', async () => {
    const res = await request(createApp())
      .post('/webhooks/nonexistent')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('AUTOMATION_NOT_FOUND');
  });

  it('returns 404 for cron-only automation', async () => {
    const res = await request(createApp())
      .post('/webhooks/cron-only')
      .send({});

    expect(res.status).toBe(404);
  });
});
