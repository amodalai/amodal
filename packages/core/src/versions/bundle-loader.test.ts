/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  loadBundleFromUrl,
  loadBundleFromFile,
  loadBundle,
  VersionBundleError,
} from './bundle-loader.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

const minimalBundle = { version: '1.0.0' };

describe('loadBundleFromUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and validates a bundle from URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(minimalBundle),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await loadBundleFromUrl('https://api.example.com/bundle');
    expect(result.version).toBe('1.0.0');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/bundle',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('throws FETCH_FAILED on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    );

    await expect(
      loadBundleFromUrl('https://api.example.com/bundle'),
    ).rejects.toThrow(VersionBundleError);

    try {
      await loadBundleFromUrl('https://api.example.com/bundle');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('FETCH_FAILED');
    }
  });

  it('throws FETCH_FAILED on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    try {
      await loadBundleFromUrl('https://api.example.com/bundle');
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersionBundleError);
      expect((err as VersionBundleError).code).toBe('FETCH_FAILED');
      expect((err as VersionBundleError).message).toContain('404');
    }
  });

  it('throws PARSE_FAILED on invalid JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('invalid json')),
      }),
    );

    try {
      await loadBundleFromUrl('https://api.example.com/bundle');
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('PARSE_FAILED');
    }
  });

  it('throws VALIDATION_FAILED on invalid bundle data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ not: 'a bundle' }),
      }),
    );

    try {
      await loadBundleFromUrl('https://api.example.com/bundle');
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('loadBundleFromFile', () => {
  it('loads and validates a bundle from file', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(minimalBundle));
    const result = await loadBundleFromFile('/tmp/bundle.json');
    expect(result.version).toBe('1.0.0');
  });

  it('throws FETCH_FAILED when file not found', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    try {
      await loadBundleFromFile('/tmp/missing.json');
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('FETCH_FAILED');
    }
  });

  it('throws PARSE_FAILED on invalid JSON in file', async () => {
    vi.mocked(readFile).mockResolvedValue('not json{');

    try {
      await loadBundleFromFile('/tmp/bad.json');
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('PARSE_FAILED');
    }
  });

  it('throws VALIDATION_FAILED on invalid bundle in file', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ not: 'a bundle' }),
    );

    try {
      await loadBundleFromFile('/tmp/invalid.json');
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('loadBundle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delegates to URL loader when url is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(minimalBundle),
      }),
    );

    const result = await loadBundle({ url: 'https://api.example.com/bundle' });
    expect(result.version).toBe('1.0.0');
  });

  it('delegates to file loader when path is provided', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(minimalBundle));
    const result = await loadBundle({ path: '/tmp/bundle.json' });
    expect(result.version).toBe('1.0.0');
  });

  it('throws when both url and path are provided', async () => {
    try {
      await loadBundle({
        url: 'https://api.example.com/bundle',
        path: '/tmp/bundle.json',
      });
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('VALIDATION_FAILED');
      expect((err as VersionBundleError).message).toContain('not both');
    }
  });

  it('throws when neither url nor path is provided', async () => {
    try {
      await loadBundle({});
      expect.fail('should throw');
    } catch (err) {
      expect((err as VersionBundleError).code).toBe('VALIDATION_FAILED');
    }
  });
});
