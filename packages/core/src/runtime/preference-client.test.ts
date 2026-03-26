/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {PreferenceClient, formatPreferencesPrompt} from './preference-client.js';

describe('PreferenceClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches preferences for a user', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        preferences: [
          {id: 'p1', category: 'style', preference: 'Use tables', confidence: 0.9, source: 'explicit'},
        ],
      }),
    });

    const client = new PreferenceClient('http://localhost:4000', 'key-123');
    const prefs = await client.fetchPreferences('user-1', 'org-1');

    expect(prefs).toHaveLength(1);
    expect(prefs[0].preference).toBe('Use tables');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/learning/preferences?userId=user-1&orgId=org-1'),
      expect.anything(),
    );
  });

  it('returns empty array on fetch error', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));

    const client = new PreferenceClient('http://localhost:4000', 'key-123');
    const prefs = await client.fetchPreferences('user-1', 'org-1');

    expect(prefs).toEqual([]);
  });

  it('returns empty array on non-ok response', async () => {
    fetchSpy.mockResolvedValue({ok: false, status: 500});

    const client = new PreferenceClient('http://localhost:4000', 'key-123');
    const prefs = await client.fetchPreferences('user-1', 'org-1');

    expect(prefs).toEqual([]);
  });

  it('reports a preference without throwing on error', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));

    const client = new PreferenceClient('http://localhost:4000', 'key-123');
    // Should not throw
    await client.reportPreference('user-1', 'org-1', {
      category: 'style',
      preference: 'Use bullet points',
      source: 'correction',
    }, 'sess-1');
  });

  it('reports a preference via POST', async () => {
    fetchSpy.mockResolvedValue({ok: true});

    const client = new PreferenceClient('http://localhost:4000', 'key-123');
    await client.reportPreference('user-1', 'org-1', {
      category: 'style',
      preference: 'Use bullet points',
      source: 'correction',
    }, 'sess-1');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:4000/api/learning/preferences',
      expect.objectContaining({method: 'POST'}),
    );
  });
});

describe('formatPreferencesPrompt', () => {
  it('returns empty string for no preferences', () => {
    expect(formatPreferencesPrompt([])).toBe('');
  });

  it('formats preferences as system prompt section', () => {
    const result = formatPreferencesPrompt([
      {id: 'p1', category: 'style', preference: 'Use tables for data', confidence: 0.9, source: 'explicit'},
      {id: 'p2', category: 'content', preference: 'Include code examples', confidence: 0.7, source: 'correction'},
    ]);

    expect(result).toContain('Known User Preferences');
    expect(result).toContain('[style] Use tables for data');
    expect(result).toContain('[content] Include code examples');
    expect(result).toContain('90%');
    expect(result).toContain('70%');
  });
});
