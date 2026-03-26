/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {createHmac} from 'node:crypto';
import {describe, it, expect, vi, afterEach} from 'vitest';
import {deliverResult, verifyHmacSignature} from './delivery.js';
import type {DeliveryPayload} from './delivery.js';

describe('deliverResult', () => {
  const payload: DeliveryPayload = {
    automation: 'daily-check',
    response: 'All systems nominal.',
    timestamp: '2025-01-01T00:00:00Z',
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('delivers to stdout when no webhook URL provided', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = await deliverResult(payload);
    expect(result).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify(payload) + '\n');
  });

  it('POSTs to webhook URL when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ok: true});
    vi.stubGlobal('fetch', mockFetch);

    const result = await deliverResult(payload, 'https://hooks.example.com/finops');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.example.com/finops',
      expect.objectContaining({method: 'POST'}),
    );
  });

  it('includes HMAC signature when secret provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ok: true});
    vi.stubGlobal('fetch', mockFetch);

    await deliverResult(payload, 'https://hooks.example.com', 'my-secret');

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers['X-Amodal-Signature']).toMatch(/^sha256=/);
  });

  it('returns false when webhook fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const result = await deliverResult(payload, 'https://hooks.example.com');
    expect(result).toBe(false);
  });

  it('returns false when webhook returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, status: 500}));
    const result = await deliverResult(payload, 'https://hooks.example.com');
    expect(result).toBe(false);
  });
});

describe('verifyHmacSignature', () => {
  it('verifies a valid signature', () => {
    const body = '{"test": true}';
    const secret = 'webhook-secret';
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyHmacSignature(body, sig, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    expect(verifyHmacSignature('body', 'sha256=invalid', 'secret')).toBe(false);
  });

  it('rejects wrong length signature', () => {
    expect(verifyHmacSignature('body', 'short', 'secret')).toBe(false);
  });
});
