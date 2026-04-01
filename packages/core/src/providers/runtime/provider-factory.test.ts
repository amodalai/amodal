/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {createRuntimeProvider} from './provider-factory.js';
import {AnthropicRuntimeProvider} from './anthropic-provider.js';
import {OpenAIRuntimeProvider} from './openai-provider.js';
import {GoogleRuntimeProvider} from './google-provider.js';
import {BedrockRuntimeProvider} from './bedrock-provider.js';
import {AzureOpenAIRuntimeProvider} from './azure-provider.js';
import {ProviderError} from './provider-errors.js';

// Mock SDK imports so constructors don't fail on missing keys
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({messages: {create: vi.fn()}})),
}));
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({chat: {completions: {create: vi.fn()}}})),
  AzureOpenAI: vi.fn().mockImplementation(() => ({chat: {completions: {create: vi.fn()}}})),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({models: {generateContent: vi.fn()}})),
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({send: vi.fn()})),
  ConverseCommand: vi.fn(),
}));

describe('createRuntimeProvider', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_API_KEY', 'test-key');
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-key');
    vi.stubEnv('AZURE_OPENAI_RESOURCE', 'test-resource');
    vi.stubEnv('AWS_REGION', 'us-east-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create AnthropicRuntimeProvider for anthropic', () => {
    const provider = createRuntimeProvider({provider: 'anthropic', model: 'claude-sonnet-4-20250514'});
    expect(provider).toBeInstanceOf(AnthropicRuntimeProvider);
  });

  it('should create OpenAIRuntimeProvider for openai', () => {
    const provider = createRuntimeProvider({provider: 'openai', model: 'gpt-4o'});
    expect(provider).toBeInstanceOf(OpenAIRuntimeProvider);
  });

  it('should create GoogleRuntimeProvider for google', () => {
    const provider = createRuntimeProvider({provider: 'google', model: 'gemini-2.0-flash'});
    expect(provider).toBeInstanceOf(GoogleRuntimeProvider);
  });

  it('should create BedrockRuntimeProvider for bedrock', () => {
    const provider = createRuntimeProvider({provider: 'bedrock', model: 'anthropic.claude-3-sonnet-20240229-v1:0'});
    expect(provider).toBeInstanceOf(BedrockRuntimeProvider);
  });

  it('should create AzureOpenAIRuntimeProvider for azure', () => {
    const provider = createRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    expect(provider).toBeInstanceOf(AzureOpenAIRuntimeProvider);
  });

  it('should create OpenAIRuntimeProvider for unknown provider with baseUrl', () => {
    const provider = createRuntimeProvider({
      provider: 'vllm',
      model: 'llama-3',
      baseUrl: 'http://localhost:8000/v1',
    });
    expect(provider).toBeInstanceOf(OpenAIRuntimeProvider);
  });

  it('should throw for unknown provider without baseUrl', () => {
    expect(() => createRuntimeProvider({provider: 'unknown', model: 'test'})).toThrow(ProviderError);
  });

  it('should create OpenAIRuntimeProvider for deepseek', () => {
    const provider = createRuntimeProvider({provider: 'deepseek', model: 'deepseek-chat'});
    expect(provider).toBeInstanceOf(OpenAIRuntimeProvider);
  });

  it('should create OpenAIRuntimeProvider for groq', () => {
    const provider = createRuntimeProvider({provider: 'groq', model: 'llama-3.3-70b-versatile'});
    expect(provider).toBeInstanceOf(OpenAIRuntimeProvider);
  });

  it('should create OpenAIRuntimeProvider for ollama with baseUrl', () => {
    const provider = createRuntimeProvider({
      provider: 'ollama',
      model: 'codellama',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(provider).toBeInstanceOf(OpenAIRuntimeProvider);
  });

  it('should create OpenAIRuntimeProvider for together with baseUrl', () => {
    const provider = createRuntimeProvider({
      provider: 'together',
      model: 'meta-llama/Llama-3-70b',
      baseUrl: 'https://api.together.xyz/v1',
    });
    expect(provider).toBeInstanceOf(OpenAIRuntimeProvider);
  });
});
