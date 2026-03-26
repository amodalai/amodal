/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { PlatformConfigSchema } from './platform-types.js';

describe('PlatformConfigSchema', () => {
  it('accepts valid platform config', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'https://platform.company.com',
      apiKey: 'sk-platform-abc123',
      deployment: 'prod',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://platform.company.com');
      expect(result.data.apiKey).toBe('sk-platform-abc123');
      expect(result.data.deployment).toBe('prod');
    }
  });

  it('rejects missing apiUrl', () => {
    const result = PlatformConfigSchema.safeParse({
      apiKey: 'sk-platform-abc123',
      deployment: 'prod',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid apiUrl', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'not-a-url',
      apiKey: 'sk-platform-abc123',
      deployment: 'prod',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing apiKey', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'https://platform.company.com',
      deployment: 'prod',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty apiKey', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'https://platform.company.com',
      apiKey: '',
      deployment: 'prod',
    });
    expect(result.success).toBe(false);
  });

  it('accepts missing deployment (optional)', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'https://platform.company.com',
      apiKey: 'sk-platform-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty deployment', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'https://platform.company.com',
      apiKey: 'sk-platform-abc123',
      deployment: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts http URL', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'http://localhost:3000',
      apiKey: 'sk-test',
      deployment: 'dev',
    });
    expect(result.success).toBe(true);
  });

  it('strips extra fields', () => {
    const result = PlatformConfigSchema.safeParse({
      apiUrl: 'https://platform.company.com',
      apiKey: 'sk-platform-abc123',
      deployment: 'prod',
      extraField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extraField');
    }
  });
});
