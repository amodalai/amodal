/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import type {DeliveryConfig, FailureAlertConfig} from '@amodalai/types';
import {DeliveryRouter} from './delivery-router.js';

function makeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('DeliveryRouter', () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; body: unknown; headers: Record<string, string>}> = [];
  let mockImpl: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

  beforeEach(() => {
    calls.length = 0;
    mockImpl = null;
    globalThis.fetch = ((input: unknown, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init?.headers as Record<string, string> | undefined) ?? {},
      });
      if (mockImpl) return mockImpl(url, init);
      return Promise.resolve(new Response(null, {status: 200}));
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('onSuccess', () => {
    it('dispatches a webhook target with result', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'found 5 items', delivery);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('http://example.test/hook');
      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['automation']).toBe('scan');
      expect(body['status']).toBe('success');
      expect(body['result']).toBe('found 5 items');
    });

    it('omits result when includeResult=false', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        includeResult: false,
      };
      await router.onSuccess('scan', 'secret data', delivery);

      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['result']).toBeUndefined();
    });

    it('parses JSON output into data field', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', '{"count": 5, "top_title": "AI news"}', delivery);

      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['data']).toEqual({count: 5, top_title: 'AI news'});
    });

    it('renders template with JSON result variables', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        template: 'Found {{count}} new trending articles. Top: {{top_title}}',
      };
      await router.onSuccess('scan', '{"count": 5, "top_title": "AI news"}', delivery);

      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['message']).toBe('Found 5 new trending articles. Top: AI news');
    });

    it('renders template with built-in variables', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        template: '{{automation}} completed at {{timestamp}}',
      };
      await router.onSuccess('scan', 'done', delivery);

      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['message']).toMatch(/^scan completed at \d{4}-\d{2}-\d{2}/);
    });

    it('leaves missing template variables as literal tokens', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        template: '{{count}} items, {{missing}} unknown',
      };
      await router.onSuccess('scan', '{"count": 3}', delivery);

      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['message']).toBe('3 items, {{missing}} unknown');
    });

    it('parses fenced JSON code blocks', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', '```json\n{"count": 7}\n```', delivery);

      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['data']).toEqual({count: 7});
    });

    it('fires multiple targets in parallel', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [
          {type: 'webhook', url: 'http://a.test/hook'},
          {type: 'webhook', url: 'http://b.test/hook'},
        ],
      };
      await router.onSuccess('scan', 'done', delivery);

      expect(calls.map((c) => c.url).sort()).toEqual(['http://a.test/hook', 'http://b.test/hook']);
    });

    it('fires ISV callback target with target metadata', async () => {
      const onResult = vi.fn();
      const router = new DeliveryRouter({logger: makeLogger(), onResult});
      const delivery: DeliveryConfig = {
        targets: [{type: 'callback', name: 'primary-handler'}],
      };
      await router.onSuccess('scan', 'done', delivery);

      expect(onResult).toHaveBeenCalledTimes(1);
      expect(onResult.mock.calls[0]?.[0]).toMatchObject({
        automation: 'scan',
        status: 'success',
        result: 'done',
      });
      // Second arg carries target metadata so multi-target setups can
      // distinguish which callback is firing.
      expect(onResult.mock.calls[0]?.[1]).toEqual({name: 'primary-handler'});
    });

    it('passes undefined target name when not specified', async () => {
      const onResult = vi.fn();
      const router = new DeliveryRouter({logger: makeLogger(), onResult});
      const delivery: DeliveryConfig = {targets: [{type: 'callback'}]};
      await router.onSuccess('scan', 'done', delivery);
      expect(onResult.mock.calls[0]?.[1]).toEqual({name: undefined});
    });

    it('distinguishes multiple callback targets by name', async () => {
      const calls_: Array<{name?: string}> = [];
      const onResult = (_: unknown, target: {name?: string}): void => {
        calls_.push(target);
      };
      const router = new DeliveryRouter({logger: makeLogger(), onResult});
      const delivery: DeliveryConfig = {
        targets: [
          {type: 'callback', name: 'analytics'},
          {type: 'callback', name: 'audit-log'},
        ],
      };
      await router.onSuccess('scan', 'done', delivery);
      expect(calls_.map((c) => c.name).sort()).toEqual(['analytics', 'audit-log']);
    });

    it('warns and skips callback target when onResult is not configured', async () => {
      const logger = makeLogger();
      const router = new DeliveryRouter({logger});
      const delivery: DeliveryConfig = {
        targets: [{type: 'callback'}],
      };
      await router.onSuccess('scan', 'done', delivery);

      expect(logger.warn).toHaveBeenCalledWith(
        'delivery_callback_not_configured',
        expect.objectContaining({automation: 'scan'}),
      );
    });

    it('signs webhook with HMAC when webhookSecret is set', async () => {
      const router = new DeliveryRouter({logger: makeLogger(), webhookSecret: 'topsecret'});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'done', delivery);

      expect(calls[0]?.headers['X-Amodal-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it('does not throw when a webhook returns 500 (and retries once)', async () => {
      mockImpl = () => Promise.resolve(new Response(null, {status: 500}));
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await expect(router.onSuccess('scan', 'done', delivery)).resolves.toBeUndefined();
      // 5xx is retryable: should have fired twice (initial + 1 retry)
      expect(calls).toHaveLength(2);
    });

    it('retries on 5xx and succeeds on second attempt', async () => {
      let attempt = 0;
      mockImpl = () => {
        attempt++;
        return Promise.resolve(
          new Response(null, {status: attempt === 1 ? 503 : 200}),
        );
      };
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'done', delivery);
      expect(attempt).toBe(2);
    });

    it('does NOT retry on 4xx client errors', async () => {
      mockImpl = () => Promise.resolve(new Response(null, {status: 400}));
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'done', delivery);
      // 400 is not retryable: single attempt
      expect(calls).toHaveLength(1);
    });

    it('retries on network error and throws WebhookFailure after second attempt', async () => {
      mockImpl = () => Promise.reject(new TypeError('fetch failed'));
      const logger = makeLogger();
      const router = new DeliveryRouter({logger});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'done', delivery);
      // attempts=2 logged on failure
      expect(logger.warn).toHaveBeenCalledWith(
        'delivery_failed',
        expect.objectContaining({attempts: 2, error: expect.stringContaining('fetch failed')}),
      );
    });

    it('does nothing when delivery is undefined', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      await router.onSuccess('scan', 'done', undefined);
      expect(calls).toHaveLength(0);
    });

    it('resets failure counter on success', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      await router.onFailure('scan', 'boom', undefined);
      await router.onFailure('scan', 'boom', undefined);
      expect(router.getFailureCount('scan')).toBe(2);

      await router.onSuccess('scan', 'ok', undefined);
      expect(router.getFailureCount('scan')).toBe(0);
    });
  });

  describe('template missing-var warning', () => {
    it('warns once per automation+template+missing-keys combo', async () => {
      const logger = makeLogger();
      const router = new DeliveryRouter({logger});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        template: 'Found {{count}} items matching {{query}}',
      };
      // Only `count` present; `query` missing. Warn fires once.
      await router.onSuccess('scan', '{"count": 5}', delivery);
      await router.onSuccess('scan', '{"count": 5}', delivery);
      await router.onSuccess('scan', '{"count": 5}', delivery);

      const warnCalls = logger.warn.mock.calls.filter(
        (c) => c[0] === 'delivery_template_missing_var',
      );
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]?.[1]).toMatchObject({
        automation: 'scan',
        missing: ['query'],
      });
    });

    it('warns again if a different variable goes missing', async () => {
      const logger = makeLogger();
      const router = new DeliveryRouter({logger});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        template: '{{count}} / {{total}}',
      };
      await router.onSuccess('scan', '{"count": 5}', delivery);  // missing total
      await router.onSuccess('scan', '{"total": 10}', delivery); // missing count
      const warnCalls = logger.warn.mock.calls.filter(
        (c) => c[0] === 'delivery_template_missing_var',
      );
      expect(warnCalls).toHaveLength(2);
    });

    it('does not warn when all variables resolve', async () => {
      const logger = makeLogger();
      const router = new DeliveryRouter({logger});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        template: '{{count}} items',
      };
      await router.onSuccess('scan', '{"count": 5}', delivery);
      const warnCalls = logger.warn.mock.calls.filter(
        (c) => c[0] === 'delivery_template_missing_var',
      );
      expect(warnCalls).toHaveLength(0);
    });
  });

  describe('truncation', () => {
    it('truncates result over 16KB with truncated:true flag', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      const huge = 'A'.repeat(20_000);
      await router.onSuccess('scan', huge, delivery);

      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['truncated']).toBe(true);
      const result = body['result'] as string;
      expect(result.length).toBeLessThan(17_000);
      expect(result).toContain('truncated');
    });

    it('does not truncate result under 16KB and omits the flag', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'short output', delivery);
      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['truncated']).toBeUndefined();
      expect(body['result']).toBe('short output');
    });

    it('template still receives full untruncated result via {{result}}', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const huge = 'X'.repeat(20_000);
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
        template: 'Length: {{result.length}}',
        includeResult: false,
      };
      // includeResult=false means no `result` in payload but {{result}}
      // in template still works (uses the raw pre-truncation text).
      await router.onSuccess('scan', huge, delivery);
      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['result']).toBeUndefined();
      expect(body['message']).toBeDefined();
    });
  });

  describe('event bus emission', () => {
    it('emits delivery_succeeded on successful webhook', async () => {
      const emitted: Array<Record<string, unknown>> = [];
      const eventBus = {emit: (e: Record<string, unknown>): void => { emitted.push(e); }};
      const router = new DeliveryRouter({logger: makeLogger(), eventBus});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'done', delivery);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        type: 'delivery_succeeded',
        automation: 'scan',
        targetType: 'webhook',
        targetUrl: 'http://example.test/hook',
        httpStatus: 200,
      });
      expect(typeof emitted[0]?.['durationMs']).toBe('number');
    });

    it('emits delivery_succeeded on successful callback', async () => {
      const emitted: Array<Record<string, unknown>> = [];
      const eventBus = {emit: (e: Record<string, unknown>): void => { emitted.push(e); }};
      const router = new DeliveryRouter({logger: makeLogger(), onResult: vi.fn(), eventBus});
      const delivery: DeliveryConfig = {targets: [{type: 'callback'}]};
      await router.onSuccess('scan', 'done', delivery);
      expect(emitted[0]).toMatchObject({
        type: 'delivery_succeeded',
        automation: 'scan',
        targetType: 'callback',
      });
      expect(emitted[0]?.['targetUrl']).toBeUndefined();
    });

    it('emits delivery_failed with attempt count and status', async () => {
      mockImpl = () => Promise.resolve(new Response(null, {status: 500}));
      const emitted: Array<Record<string, unknown>> = [];
      const eventBus = {emit: (e: Record<string, unknown>): void => { emitted.push(e); }};
      const router = new DeliveryRouter({logger: makeLogger(), eventBus});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'done', delivery);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        type: 'delivery_failed',
        automation: 'scan',
        targetType: 'webhook',
        targetUrl: 'http://example.test/hook',
        httpStatus: 500,
        attempts: 2,
      });
    });

    it('emits delivery_failed with attempts=1 for 4xx (no retry)', async () => {
      mockImpl = () => Promise.resolve(new Response(null, {status: 404}));
      const emitted: Array<Record<string, unknown>> = [];
      const eventBus = {emit: (e: Record<string, unknown>): void => { emitted.push(e); }};
      const router = new DeliveryRouter({logger: makeLogger(), eventBus});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await router.onSuccess('scan', 'done', delivery);
      expect(emitted[0]).toMatchObject({attempts: 1, httpStatus: 404});
    });
  });

  describe('onFailure', () => {
    it('increments consecutive failure counter', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      await router.onFailure('scan', 'err1', undefined);
      await router.onFailure('scan', 'err2', undefined);
      await router.onFailure('scan', 'err3', undefined);
      expect(router.getFailureCount('scan')).toBe(3);
    });

    it('does not fire alert below threshold', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const alert: FailureAlertConfig = {
        after: 3,
        targets: [{type: 'webhook', url: 'http://example.test/alert'}],
      };
      await router.onFailure('scan', 'err1', alert);
      await router.onFailure('scan', 'err2', alert);
      expect(calls).toHaveLength(0);

      await router.onFailure('scan', 'err3', alert);
      expect(calls).toHaveLength(1);
      const body = calls[0]?.body as Record<string, unknown>;
      expect(body['status']).toBe('failure');
      expect(body['error']).toBe('err3');
    });

    it('fires on first failure when after=1 (default)', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const alert: FailureAlertConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/alert'}],
      };
      await router.onFailure('scan', 'boom', alert);
      expect(calls).toHaveLength(1);
    });

    it('respects cooldown window between alerts', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      const alert: FailureAlertConfig = {
        after: 1,
        cooldownMinutes: 60,
        targets: [{type: 'webhook', url: 'http://example.test/alert'}],
      };
      await router.onFailure('scan', 'err1', alert);
      expect(calls).toHaveLength(1);

      await router.onFailure('scan', 'err2', alert);
      expect(calls).toHaveLength(1);

      await router.onFailure('scan', 'err3', alert);
      expect(calls).toHaveLength(1);
    });

    it('fires again after cooldown expires', async () => {
      vi.useFakeTimers();
      try {
        const router = new DeliveryRouter({logger: makeLogger()});
        const alert: FailureAlertConfig = {
          after: 1,
          cooldownMinutes: 1,
          targets: [{type: 'webhook', url: 'http://example.test/alert'}],
        };
        await router.onFailure('scan', 'err1', alert);
        expect(calls).toHaveLength(1);

        vi.advanceTimersByTime(61_000);
        await router.onFailure('scan', 'err2', alert);
        expect(calls).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does nothing when failureAlert is undefined', async () => {
      const router = new DeliveryRouter({logger: makeLogger()});
      await router.onFailure('scan', 'boom', undefined);
      expect(calls).toHaveLength(0);
    });
  });
});
