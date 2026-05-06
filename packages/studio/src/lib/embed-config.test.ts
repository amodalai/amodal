/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  buildEmbedSnippet,
  DEFAULT_EMBED_CONFIG,
  normalizeEmbedConfig,
  readEmbedConfigFromAmodalJson,
  writeEmbedConfigToAmodalJson,
} from './embed-config';

describe('embed config helpers', () => {
  it('normalizes unknown values to defaults', () => {
    const config = normalizeEmbedConfig({
      position: 'sideways',
      defaultOpen: true,
      allowedDomains: ['Example.COM', '', 'example.com'],
      theme: { headerText: 'Support' },
    });

    expect(config.position).toBe(DEFAULT_EMBED_CONFIG.position);
    expect(config.defaultOpen).toBe(true);
    expect(config.allowedDomains).toEqual(['example.com']);
    expect(config.theme.headerText).toBe('Support');
    expect(config.theme.primaryColor).toBe(DEFAULT_EMBED_CONFIG.theme.primaryColor);
  });

  it('reads and writes the embed block without dropping other amodal.json fields', () => {
    const original = JSON.stringify({
      name: 'content-marketing',
      version: '1.0.0',
      models: { main: { provider: 'google', model: 'gemini' } },
    });
    const updated = writeEmbedConfigToAmodalJson(original, {
      ...DEFAULT_EMBED_CONFIG,
      position: 'right',
      theme: { ...DEFAULT_EMBED_CONFIG.theme, headerText: 'Content Ops' },
    });

    const parsed = JSON.parse(updated) as Record<string, unknown>;
    expect(parsed['name']).toBe('content-marketing');
    expect(parsed['models']).toEqual({ main: { provider: 'google', model: 'gemini' } });
    expect(readEmbedConfigFromAmodalJson(updated).position).toBe('right');
    expect(readEmbedConfigFromAmodalJson(updated).theme.headerText).toBe('Content Ops');
  });

  it('generates a widget snippet with scope when required', () => {
    const snippet = buildEmbedSnippet({
      serverUrl: 'https://agent.example.com',
      config: { ...DEFAULT_EMBED_CONFIG, scopeMode: 'required' },
    });

    expect(snippet).toContain("from '@amodalai/react/widget'");
    expect(snippet).toContain('serverUrl="https://agent.example.com"');
    expect(snippet).toContain('scopeId={tenant.id}');
  });
});

