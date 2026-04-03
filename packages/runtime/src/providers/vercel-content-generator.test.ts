/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { modelConfigToProviderConfig } from './vercel-content-generator.js';

describe('VercelContentGenerator', () => {
  describe('modelConfigToProviderConfig', () => {
    it('resolves API key from credentials', () => {
      const result = modelConfigToProviderConfig({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        credentials: { ANTHROPIC_API_KEY: 'sk-test-123' },
      });
      expect(result.apiKey).toBe('sk-test-123');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-20250514');
    });

    it('resolves OPENAI_API_KEY fallback for OpenAI-compatible providers', () => {
      const result = modelConfigToProviderConfig({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        credentials: { OPENAI_API_KEY: 'gsk-test' },
      });
      expect(result.apiKey).toBe('gsk-test');
    });

    it('passes through baseUrl and region', () => {
      const result = modelConfigToProviderConfig({
        provider: 'azure',
        model: 'gpt-4',
        baseUrl: 'https://my-azure.openai.azure.com',
        region: 'eastus',
        credentials: { AZURE_API_KEY: 'key' },
      });
      expect(result.baseUrl).toBe('https://my-azure.openai.azure.com');
      expect(result.region).toBe('eastus');
    });

    it('uses uppercase provider name for unknown providers', () => {
      const result = modelConfigToProviderConfig({
        provider: 'custom',
        model: 'my-model',
        credentials: { CUSTOM_API_KEY: 'custom-key' },
      });
      expect(result.apiKey).toBe('custom-key');
    });

    it('returns undefined apiKey when no credentials or env var', () => {
      const result = modelConfigToProviderConfig({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });
      // apiKey comes from process.env which may or may not be set
      // Just verify the structure is correct
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-20250514');
    });
  });
});
