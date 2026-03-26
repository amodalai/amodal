/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AutomationDefinition } from '@amodalai/core';
import { AutomationScheduler } from './heartbeat-scheduler.js';

function makeAutomation(
  name: string,
  triggerType: 'cron' | 'webhook' = 'cron',
  schedule = '*/5 * * * *',
): AutomationDefinition {
  return {
    name,
    trigger:
      triggerType === 'cron'
        ? { type: 'cron', schedule }
        : { type: 'webhook', source: name },
    prompt: `Run ${name}`,
    tools: ['tool1'],
    skills: ['*'],
    output: { channel: 'slack', target: 'https://hooks.slack.com/abc' },
    allow_writes: false,
  };
}

describe('AutomationScheduler', () => {
  let scheduler: AutomationScheduler;

  beforeEach(() => {
    scheduler = new AutomationScheduler();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('registers cron automations', () => {
    const mockRunner = vi.fn().mockResolvedValue({});
    scheduler.start(
      [makeAutomation('a1'), makeAutomation('a2')],
      mockRunner,
    );
    expect(scheduler.size).toBe(2);
  });

  it('ignores webhook automations', () => {
    const mockRunner = vi.fn().mockResolvedValue({});
    scheduler.start(
      [
        makeAutomation('cron-a'),
        makeAutomation('webhook-a', 'webhook'),
      ],
      mockRunner,
    );
    expect(scheduler.size).toBe(1);
  });

  it('skips invalid cron schedules', () => {
    const mockRunner = vi.fn().mockResolvedValue({});
    scheduler.start(
      [makeAutomation('bad-a', 'cron', 'not-a-cron')],
      mockRunner,
    );
    expect(scheduler.size).toBe(0);
  });

  it('stops all jobs on stop()', () => {
    const mockRunner = vi.fn().mockResolvedValue({});
    scheduler.start([makeAutomation('a1')], mockRunner);
    expect(scheduler.size).toBe(1);

    scheduler.stop();
    expect(scheduler.size).toBe(0);
  });

  it('handles empty automation list', () => {
    const mockRunner = vi.fn().mockResolvedValue({});
    scheduler.start([], mockRunner);
    expect(scheduler.size).toBe(0);
  });
});
