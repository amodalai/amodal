/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutomationResult } from '../types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamic imports after mocking
const { sendSlackOutput } = await import('./slack-output.js');
const { sendWebhookOutput } = await import('./webhook-output.js');
const { sendEmailOutput } = await import('./email-output.js');
const { routeOutput } = await import('./output-router.js');

function makeResult(overrides: Partial<AutomationResult> = {}): AutomationResult {
  return {
    automation: 'zone-monitor',
    response: 'All zones clear.',
    tool_calls: [
      {
        tool_name: 'get_zone_overview',
        tool_id: 'call-1',
        status: 'success',
        duration_ms: 120,
      },
    ],
    output_sent: false,
    duration_ms: 500,
    ...overrides,
  };
}

describe('sendSlackOutput', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('posts formatted blocks to Slack webhook URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendSlackOutput('https://hooks.slack.com/abc', makeResult());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.slack.com/abc');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.blocks).toBeDefined();
    expect(body.blocks.length).toBeGreaterThanOrEqual(3);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(
      sendSlackOutput('https://hooks.slack.com/abc', makeResult()),
    ).rejects.toThrow('Slack webhook failed');
  });

  it('includes tool call summary in blocks', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendSlackOutput('https://hooks.slack.com/abc', makeResult());

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    const toolBlock = body.blocks.find(
      (b: Record<string, unknown>) =>
        typeof b['text'] === 'object' &&
        ((b['text'] as Record<string, string>)['text'] ?? '').includes('Tool calls'),
    );
    expect(toolBlock).toBeDefined();
  });
});

describe('sendWebhookOutput', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('posts JSON to generic webhook URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendWebhookOutput('https://example.com/hook', makeResult());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    const body = JSON.parse(opts.body as string);
    expect(body.automation).toBe('zone-monitor');
    expect(body.response).toBe('All zones clear.');
    expect(body.tool_calls).toHaveLength(1);
    expect(body.timestamp).toBeDefined();
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(
      sendWebhookOutput('https://example.com/hook', makeResult()),
    ).rejects.toThrow('Webhook failed');
  });
});

describe('sendEmailOutput', () => {
  it('logs warning to stderr', async () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await sendEmailOutput('admin@example.com', makeResult());

    expect(writeSpy).toHaveBeenCalledOnce();
    const msg = writeSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('Email output not implemented');
    expect(msg).toContain('admin@example.com');
  });
});

describe('routeOutput', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('routes to slack channel', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const sent = await routeOutput(
      { channel: 'slack', target: 'https://hooks.slack.com/abc' },
      makeResult(),
    );
    expect(sent).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('routes to webhook channel', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const sent = await routeOutput(
      { channel: 'webhook', target: 'https://example.com/hook' },
      makeResult(),
    );
    expect(sent).toBe(true);
  });

  it('routes to email channel (stub)', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const sent = await routeOutput(
      { channel: 'email', target: 'admin@example.com' },
      makeResult(),
    );
    expect(sent).toBe(true);
  });

  it('returns false and logs for unknown channel', async () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const sent = await routeOutput(
      { channel: 'sms' as unknown as 'slack', target: '+1234567890' },
      makeResult(),
    );
    expect(sent).toBe(false);
    expect(writeSpy).toHaveBeenCalled();
  });

  it('catches errors and returns false', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const sent = await routeOutput(
      { channel: 'slack', target: 'https://hooks.slack.com/abc' },
      makeResult(),
    );
    expect(sent).toBe(false);
  });
});
