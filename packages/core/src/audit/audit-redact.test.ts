/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { isSensitiveKey, redactSensitiveParams } from './audit-redact.js';

describe('isSensitiveKey', () => {
  it('detects api_key variations', () => {
    expect(isSensitiveKey('api_key')).toBe(true);
    expect(isSensitiveKey('API_KEY')).toBe(true);
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('api-key')).toBe(true);
  });

  it('detects secret, password, token', () => {
    expect(isSensitiveKey('secret')).toBe(true);
    expect(isSensitiveKey('client_secret')).toBe(true);
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('access_token')).toBe(true);
    expect(isSensitiveKey('TOKEN')).toBe(true);
  });

  it('detects auth, credential, bearer, authorization', () => {
    expect(isSensitiveKey('auth')).toBe(true);
    expect(isSensitiveKey('credential')).toBe(true);
    expect(isSensitiveKey('bearer')).toBe(true);
    expect(isSensitiveKey('authorization')).toBe(true);
    expect(isSensitiveKey('Authorization')).toBe(true);
  });

  it('does not flag non-sensitive keys', () => {
    expect(isSensitiveKey('zone')).toBe(false);
    expect(isSensitiveKey('device_id')).toBe(false);
    expect(isSensitiveKey('name')).toBe(false);
    expect(isSensitiveKey('author')).toBe(false);
  });
});

describe('redactSensitiveParams', () => {
  it('redacts top-level sensitive keys', () => {
    const result = redactSensitiveParams({
      api_key: 'sk-123',
      zone: 'A1',
    });
    expect(result).toEqual({
      api_key: '[REDACTED]',
      zone: 'A1',
    });
  });

  it('redacts nested sensitive keys', () => {
    const result = redactSensitiveParams({
      headers: {
        authorization: 'Bearer abc',
        'Content-Type': 'application/json',
      },
    });
    expect(result).toEqual({
      headers: {
        authorization: '[REDACTED]',
        'Content-Type': 'application/json',
      },
    });
  });

  it('does not mutate the original object', () => {
    const original: Record<string, unknown> = { api_key: 'sk-123', zone: 'A1' };
    const result = redactSensitiveParams(original);
    expect(original['api_key']).toBe('sk-123');
    expect(result['api_key']).toBe('[REDACTED]');
  });

  it('handles deeply nested objects', () => {
    const result = redactSensitiveParams({
      level1: {
        level2: {
          password: 'deep-secret',
          value: 42,
        },
      },
    });
    expect(result).toEqual({
      level1: {
        level2: {
          password: '[REDACTED]',
          value: 42,
        },
      },
    });
  });

  it('handles arrays containing objects', () => {
    const result = redactSensitiveParams({
      items: [
        { id: 1, token: 'abc' },
        { id: 2, name: 'test' },
      ],
    });
    expect(result).toEqual({
      items: [
        { id: 1, token: '[REDACTED]' },
        { id: 2, name: 'test' },
      ],
    });
  });

  it('handles arrays of primitives unchanged', () => {
    const result = redactSensitiveParams({
      ids: [1, 2, 3],
      tags: ['a', 'b'],
    });
    expect(result).toEqual({
      ids: [1, 2, 3],
      tags: ['a', 'b'],
    });
  });

  it('returns empty object for empty input', () => {
    expect(redactSensitiveParams({})).toEqual({});
  });

  it('handles null and undefined values gracefully', () => {
    const result = redactSensitiveParams({
      name: null,
      value: undefined,
      api_key: null,
    });
    expect(result).toEqual({
      name: null,
      value: undefined,
      api_key: '[REDACTED]',
    });
  });
});
