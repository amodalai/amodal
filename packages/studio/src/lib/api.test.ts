/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach} from 'vitest';
import {getBasePath, studioApiUrl} from './api.js';

describe('getBasePath (browser)', () => {
  afterEach(() => {
    // Clean up any injected global
    delete (globalThis as Record<string, unknown>)['__STUDIO_BASE_PATH__'];
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>)['__STUDIO_BASE_PATH__'];
    }
  });

  it('returns empty string when no window global is set', () => {
    expect(getBasePath()).toBe('');
  });

  it('reads from window.__STUDIO_BASE_PATH__', () => {
    (globalThis as Record<string, unknown>)['window'] = globalThis;
    (globalThis as Record<string, unknown>)['__STUDIO_BASE_PATH__'] = '/studio';
    expect(getBasePath()).toBe('/studio');
    delete (globalThis as Record<string, unknown>)['__STUDIO_BASE_PATH__'];
    delete (globalThis as Record<string, unknown>)['window'];
  });
});

describe('studioApiUrl', () => {
  afterEach(() => {
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>)['__STUDIO_BASE_PATH__'];
    }
  });

  it('returns path unchanged when no base path', () => {
    expect(studioApiUrl('/api/config')).toBe('/api/config');
  });

  it('prefixes path with base path', () => {
    // Simulate browser environment with base path
    (globalThis as Record<string, unknown>)['window'] = globalThis;
    (globalThis as Record<string, unknown>)['__STUDIO_BASE_PATH__'] = '/studio';
    expect(studioApiUrl('/api/config')).toBe('/studio/api/config');
    expect(studioApiUrl('/api/memory')).toBe('/studio/api/memory');
    expect(studioApiUrl('/api/stores/notes/documents')).toBe('/studio/api/stores/notes/documents');
    delete (globalThis as Record<string, unknown>)['__STUDIO_BASE_PATH__'];
    delete (globalThis as Record<string, unknown>)['window'];
  });
});
