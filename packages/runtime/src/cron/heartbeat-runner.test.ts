/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutomationDefinition } from '@amodalai/core';

// Mock dependencies
const mockRunMessage = vi.fn();
vi.mock('../session/session-runner.js', () => ({
  runMessage: (...args: unknown[]) => mockRunMessage(...args),
}));

const mockRouteOutput = vi.fn();
vi.mock('../output/output-router.js', () => ({
  routeOutput: (...args: unknown[]) => mockRouteOutput(...args),
}));

const { createAutomationRunner } = await import('./heartbeat-runner.js');

function makeAutomation(
  overrides: Partial<AutomationDefinition> = {},
): AutomationDefinition {
  return {
    name: 'zone-monitor',
    trigger: { type: 'cron', schedule: '*/5 * * * *' },
    prompt: 'Check all zones.',
    tools: ['get_zone_overview'],
    skills: ['*'],
    output: { channel: 'slack', target: 'https://hooks.slack.com/abc' },
    allow_writes: false,
    ...overrides,
  };
}

describe('createAutomationRunner', () => {
  const mockCreate = vi.fn();
  const mockDestroy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      id: 'hb-sess-1',
      config: {},
      geminiClient: {},
      scheduler: {},
    });
    mockDestroy.mockResolvedValue(undefined);
    mockRunMessage.mockResolvedValue({
      session_id: 'hb-sess-1',
      response: 'All clear.',
      tool_calls: [],
    });
    mockRouteOutput.mockResolvedValue(true);
  });

  function makeRunner() {
    return createAutomationRunner({
      sessionManager: {
        create: mockCreate,
        destroy: mockDestroy,
      } as never,
    });
  }

  it('creates session, runs prompt, routes output, and destroys session', async () => {
    const runner = makeRunner();
    const result = await runner(makeAutomation());

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockRunMessage).toHaveBeenCalledOnce();
    expect(mockRouteOutput).toHaveBeenCalledOnce();
    expect(mockDestroy).toHaveBeenCalledWith('hb-sess-1');
    expect(result.automation).toBe('zone-monitor');
    expect(result.response).toBe('All clear.');
    expect(result.output_sent).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('includes payload data in prompt', async () => {
    const runner = makeRunner();
    await runner(makeAutomation(), { device_id: '42' });

    const promptArg = (mockRunMessage.mock.calls[0] as unknown[])[1] as string;
    expect(promptArg).toContain('Check all zones.');
    expect(promptArg).toContain('device_id');
    expect(promptArg).toContain('42');
  });

  it('handles session creation failure gracefully', async () => {
    mockCreate.mockRejectedValue(new Error('config error'));
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const runner = makeRunner();
    const result = await runner(makeAutomation());

    expect(result.automation).toBe('zone-monitor');
    expect(result.response).toBe('');
    expect(result.output_sent).toBe(false);
  });

  it('handles runMessage failure gracefully', async () => {
    mockRunMessage.mockRejectedValue(new Error('LLM error'));
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const runner = makeRunner();
    const result = await runner(makeAutomation());

    expect(result.response).toBe('');
    expect(result.output_sent).toBe(false);
    expect(mockDestroy).toHaveBeenCalledOnce(); // Still cleans up
  });

  it('handles output routing failure gracefully', async () => {
    mockRouteOutput.mockResolvedValue(false);

    const runner = makeRunner();
    const result = await runner(makeAutomation());

    expect(result.output_sent).toBe(false);
    expect(result.response).toBe('All clear.'); // Still has response
  });

  it('destroys session even on error', async () => {
    mockRunMessage.mockRejectedValue(new Error('boom'));
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const runner = makeRunner();
    await runner(makeAutomation());

    expect(mockDestroy).toHaveBeenCalledWith('hb-sess-1');
  });

  it('respects timeout constraint', async () => {
    // Create a slow runMessage
    mockRunMessage.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );

    const runner = makeRunner();
    const automation = makeAutomation({
      constraints: { timeout_seconds: 1 },
    });

    // This should still complete (1s timeout > 100ms)
    await runner(automation);
    expect(mockRunMessage).toHaveBeenCalledOnce();
  });
});
