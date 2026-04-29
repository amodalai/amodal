/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach} from 'vitest';
import {getBasePath} from './config.js';

describe('getBasePath', () => {
  const originalEnv = process.env['BASE_PATH'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['BASE_PATH'] = originalEnv;
    } else {
      delete process.env['BASE_PATH'];
    }
  });

  it('returns empty string when BASE_PATH is not set', () => {
    delete process.env['BASE_PATH'];
    expect(getBasePath()).toBe('');
  });

  it('returns empty string when BASE_PATH is empty', () => {
    process.env['BASE_PATH'] = '';
    expect(getBasePath()).toBe('');
  });

  it('returns the path with leading slash', () => {
    process.env['BASE_PATH'] = '/studio';
    expect(getBasePath()).toBe('/studio');
  });

  it('adds leading slash if missing', () => {
    process.env['BASE_PATH'] = 'studio';
    expect(getBasePath()).toBe('/studio');
  });

  it('strips trailing slash', () => {
    process.env['BASE_PATH'] = '/studio/';
    expect(getBasePath()).toBe('/studio');
  });

  it('handles both missing leading and trailing slash', () => {
    process.env['BASE_PATH'] = 'studio/';
    expect(getBasePath()).toBe('/studio');
  });

  it('handles nested paths', () => {
    process.env['BASE_PATH'] = '/app/studio';
    expect(getBasePath()).toBe('/app/studio');
  });
});
