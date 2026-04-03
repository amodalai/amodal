/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {createProvider} from './create-provider.js';
import {ConfigError} from '../errors.js';
import type {LLMProvider, ProviderConfig} from './types.js';

describe('createProvider', () => {
  it('creates an Anthropic provider', () => {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
    });

    expect(provider.provider).toBe('anthropic');
    expect(provider.model).toBe('claude-sonnet-4-20250514');
    expect(provider.languageModel).toBeDefined();
    expect(typeof provider.streamText).toBe('function');
    expect(typeof provider.generateText).toBe('function');
  });

  it('creates an OpenAI provider', () => {
    const provider = createProvider({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
    });

    expect(provider.provider).toBe('openai');
    expect(provider.model).toBe('gpt-4o');
    expect(provider.languageModel).toBeDefined();
  });

  it('creates a Google provider', () => {
    const provider = createProvider({
      provider: 'google',
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
    });

    expect(provider.provider).toBe('google');
    expect(provider.model).toBe('gemini-2.5-flash');
    expect(provider.languageModel).toBeDefined();
  });

  it('creates an OpenAI-compatible provider for known providers', () => {
    const providers: ProviderConfig[] = [
      {provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test-key'},
      {provider: 'groq', model: 'llama-3.1-70b', apiKey: 'test-key'},
      {provider: 'mistral', model: 'mistral-large', apiKey: 'test-key'},
      {provider: 'xai', model: 'grok-3', apiKey: 'test-key'},
    ];

    for (const config of providers) {
      const provider = createProvider(config);
      expect(provider.provider).toBe(config.provider);
      expect(provider.model).toBe(config.model);
      expect(provider.languageModel).toBeDefined();
    }
  });

  it('creates a custom OpenAI-compatible provider with baseUrl', () => {
    const provider = createProvider({
      provider: 'custom-llm',
      model: 'my-model',
      apiKey: 'test-key',
      baseUrl: 'https://my-llm.example.com/v1',
    });

    expect(provider.provider).toBe('custom-llm');
    expect(provider.model).toBe('my-model');
    expect(provider.languageModel).toBeDefined();
  });

  it('throws ConfigError for unknown provider without baseUrl', () => {
    expect(() =>
      createProvider({
        provider: 'unknown-provider',
        model: 'some-model',
        apiKey: 'test-key',
      }),
    ).toThrow(ConfigError);
  });

  it('supports baseUrl override for known providers', () => {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
      baseUrl: 'https://proxy.example.com/anthropic',
    });

    expect(provider.provider).toBe('anthropic');
    expect(provider.languageModel).toBeDefined();
  });

  it('satisfies LLMProvider interface', () => {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
    });

    // Type-level check: assignable to LLMProvider
    const _check: LLMProvider = provider;
    expect(_check).toBeDefined();
  });
});
