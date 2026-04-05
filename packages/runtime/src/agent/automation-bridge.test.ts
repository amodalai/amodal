/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {LoadedAutomation} from '@amodalai/core';
import {bridgeAutomation, bridgeAutomations} from './automation-bridge.js';

function makeAutomation(overrides: Partial<LoadedAutomation> = {}): LoadedAutomation {
  return {
    name: 'test-auto',
    title: 'Test Automation',
    trigger: 'cron',
    schedule: '0 9 * * 1-5',
    prompt: 'Run the daily check',
    location: '/test',
    ...overrides,
  };
}

describe('bridgeAutomation', () => {
  it('converts a cron automation', () => {
    const result = bridgeAutomation(makeAutomation());
    expect(result.name).toBe('test-auto');
    expect(result.title).toBe('Test Automation');
    expect(result.prompt).toBe('Run the daily check');
    expect(result.schedule).toBe('0 9 * * 1-5');
    expect(result.isWebhookTriggered).toBe(false);
  });

  it('detects webhook trigger', () => {
    const result = bridgeAutomation(makeAutomation({
      trigger: 'webhook',
      schedule: undefined,
    }));
    expect(result.isWebhookTriggered).toBe(true);
    expect(result.schedule).toBeUndefined();
  });

  it('handles manual trigger', () => {
    const result = bridgeAutomation(makeAutomation({
      trigger: 'manual',
      schedule: undefined,
    }));
    expect(result.isWebhookTriggered).toBe(false);
    expect(result.schedule).toBeUndefined();
  });

  it('preserves the prompt', () => {
    const prompt = 'Check revenue data from Stripe.\nCompare to baselines.\nPost to #revenue-alerts.';
    const result = bridgeAutomation(makeAutomation({prompt}));
    expect(result.prompt).toBe(prompt);
  });
});

describe('bridgeAutomation env:NAME resolution', () => {
  it('resolves env:NAME refs in delivery webhook URLs', () => {
    process.env['TEST_WEBHOOK_URL'] = 'https://hooks.example.com/abc123';
    try {
      const result = bridgeAutomation(makeAutomation({
        delivery: {
          targets: [{type: 'webhook', url: 'env:TEST_WEBHOOK_URL'}],
        },
      }));
      expect(result.delivery?.targets[0]).toEqual({
        type: 'webhook',
        url: 'https://hooks.example.com/abc123',
      });
    } finally {
      delete process.env['TEST_WEBHOOK_URL'];
    }
  });

  it('resolves env:NAME refs in failureAlert webhook URLs', () => {
    process.env['TEST_ALERT_URL'] = 'https://alerts.example.com/oncall';
    try {
      const result = bridgeAutomation(makeAutomation({
        failureAlert: {
          targets: [{type: 'webhook', url: 'env:TEST_ALERT_URL'}],
        },
      }));
      expect(result.failureAlert?.targets[0]).toEqual({
        type: 'webhook',
        url: 'https://alerts.example.com/oncall',
      });
    } finally {
      delete process.env['TEST_ALERT_URL'];
    }
  });

  it('leaves callback targets unchanged', () => {
    const result = bridgeAutomation(makeAutomation({
      delivery: {
        targets: [{type: 'callback', name: 'my-handler'}],
      },
    }));
    expect(result.delivery?.targets[0]).toEqual({type: 'callback', name: 'my-handler'});
  });

  it('leaves literal http URLs unchanged', () => {
    const result = bridgeAutomation(makeAutomation({
      delivery: {
        targets: [{type: 'webhook', url: 'https://hooks.example.com/fixed'}],
      },
    }));
    expect(result.delivery?.targets[0]).toEqual({
      type: 'webhook',
      url: 'https://hooks.example.com/fixed',
    });
  });

  it('throws at bridge time if env var is missing (fail fast at boot)', () => {
    delete process.env['NONEXISTENT_WEBHOOK'];
    expect(() => bridgeAutomation(makeAutomation({
      delivery: {
        targets: [{type: 'webhook', url: 'env:NONEXISTENT_WEBHOOK'}],
      },
    }))).toThrow(/NONEXISTENT_WEBHOOK/);
  });
});

describe('bridgeAutomations', () => {
  it('converts an array of automations', () => {
    const automations = [
      makeAutomation({name: 'auto-1', trigger: 'cron'}),
      makeAutomation({name: 'auto-2', trigger: 'webhook', schedule: undefined}),
      makeAutomation({name: 'auto-3', trigger: 'manual', schedule: undefined}),
    ];

    const results = bridgeAutomations(automations);
    expect(results).toHaveLength(3);
    expect(results[0].isWebhookTriggered).toBe(false);
    expect(results[1].isWebhookTriggered).toBe(true);
    expect(results[2].isWebhookTriggered).toBe(false);
  });

  it('returns empty array for empty input', () => {
    expect(bridgeAutomations([])).toEqual([]);
  });
});
