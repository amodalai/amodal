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

    it('fires ISV callback target', async () => {
      const onResult = vi.fn();
      const router = new DeliveryRouter({logger: makeLogger(), onResult});
      const delivery: DeliveryConfig = {
        targets: [{type: 'callback'}],
      };
      await router.onSuccess('scan', 'done', delivery);

      expect(onResult).toHaveBeenCalledTimes(1);
      expect(onResult.mock.calls[0]?.[0]).toMatchObject({
        automation: 'scan',
        status: 'success',
        result: 'done',
      });
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

    it('does not throw when a webhook returns 500', async () => {
      mockImpl = () => Promise.resolve(new Response(null, {status: 500}));
      const router = new DeliveryRouter({logger: makeLogger()});
      const delivery: DeliveryConfig = {
        targets: [{type: 'webhook', url: 'http://example.test/hook'}],
      };
      await expect(router.onSuccess('scan', 'done', delivery)).resolves.toBeUndefined();
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
