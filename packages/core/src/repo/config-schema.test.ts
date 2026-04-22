/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';

import {
  resolveEnvValue,
  resolveEnvValues,
  parseConfigJson,
  AmodalConfigSchema,
} from './config-schema.js';
import {RepoError} from './repo-types.js';

describe('resolveEnvValue', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns plain values unchanged', () => {
    expect(resolveEnvValue('hello')).toBe('hello');
    expect(resolveEnvValue('')).toBe('');
    expect(resolveEnvValue('env')).toBe('env');
  });

  it('resolves env: references', () => {
    process.env['MY_VAR'] = 'resolved-value';
    expect(resolveEnvValue('env:MY_VAR')).toBe('resolved-value');
  });

  it('throws ENV_NOT_SET for missing env vars', () => {
    delete process.env['MISSING_VAR'];
    expect(() => resolveEnvValue('env:MISSING_VAR')).toThrow(RepoError);
    expect(() => resolveEnvValue('env:MISSING_VAR')).toThrow('MISSING_VAR');
  });

  it('throws ENV_NOT_SET for empty var name', () => {
    expect(() => resolveEnvValue('env:')).toThrow(RepoError);
    try {
      resolveEnvValue('env:');
    } catch (err) {
      expect((err as RepoError).code).toBe('ENV_NOT_SET');
    }
  });

  it('resolves env var with empty string value', () => {
    process.env['EMPTY_VAR'] = '';
    expect(resolveEnvValue('env:EMPTY_VAR')).toBe('');
  });
});

describe('resolveEnvValues', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {...originalEnv};
    process.env['TEST_KEY'] = 'test-val';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves nested objects', () => {
    const input = {
      a: 'env:TEST_KEY',
      b: {c: 'plain', d: 'env:TEST_KEY'},
    };
    expect(resolveEnvValues(input)).toEqual({
      a: 'test-val',
      b: {c: 'plain', d: 'test-val'},
    });
  });

  it('resolves arrays', () => {
    expect(resolveEnvValues(['env:TEST_KEY', 'plain'])).toEqual(['test-val', 'plain']);
  });

  it('passes through non-string primitives', () => {
    expect(resolveEnvValues(42)).toBe(42);
    expect(resolveEnvValues(true)).toBe(true);
    expect(resolveEnvValues(null)).toBe(null);
  });
});

describe('AmodalConfigSchema', () => {
  it('validates a minimal config', () => {
    const config = AmodalConfigSchema.parse({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-6'},
      },
    });
    expect(config.name).toBe('test');
    expect(config.models.main.provider).toBe('anthropic');
  });

  it('validates a full config', () => {
    const config = AmodalConfigSchema.parse({
      name: 'acme-crm',
      version: '1.0.0',
      description: 'Intelligence for Acme CRM',
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-6'},
        simple: {provider: 'anthropic', model: 'claude-haiku-4-5'},
      },
      proactive: {webhook: 'https://example.com/hook'},
      platform: {projectId: 'proj-123', apiKey: 'key-456'},
    });
    expect(config.description).toBe('Intelligence for Acme CRM');
    expect(config.models.simple?.provider).toBe('anthropic');
    expect(config.proactive?.webhook).toBe('https://example.com/hook');
    expect(config.platform?.projectId).toBe('proj-123');
  });

  it('supports model fallback', () => {
    const config = AmodalConfigSchema.parse({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          fallback: {
            provider: 'openai',
            model: 'gpt-4o',
          },
        },
      },
    });
    expect(config.models.main.fallback?.provider).toBe('openai');
  });

  it('rejects empty name', () => {
    expect(() =>
      AmodalConfigSchema.parse({
        name: '',
        version: '1.0.0',
        models: {main: {provider: 'a', model: 'b'}},
      }),
    ).toThrow();
  });

  it('accepts missing models (auto-detected at runtime)', () => {
    const config = AmodalConfigSchema.parse({name: 'test', version: '1.0.0'});
    expect(config.models).toBeUndefined();
  });

  it('supports baseUrl and region on models', () => {
    const config = AmodalConfigSchema.parse({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {
          provider: 'bedrock',
          model: 'anthropic.claude-sonnet-4-6',
          region: 'us-east-1',
        },
        simple: {
          provider: 'openai-compatible',
          model: 'llama-3.3-70b',
          baseUrl: 'http://localhost:8080',
        },
      },
    });
    expect(config.models.main.region).toBe('us-east-1');
    expect(config.models.simple?.baseUrl).toBe('http://localhost:8080');
  });
});

describe('parseConfigJson', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses valid config JSON', () => {
    const json = JSON.stringify({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-6'},
      },
    });
    const config = parseConfigJson(json);
    expect(config.name).toBe('test');
  });

  it('resolves env: values in config', () => {
    process.env['MY_KEY'] = 'secret-key';
    const json = JSON.stringify({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-6'},
      },
      platform: {projectId: 'proj-1', apiKey: 'env:MY_KEY'},
    });
    const config = parseConfigJson(json);
    expect(config.platform?.apiKey).toBe('secret-key');
  });

  it('throws CONFIG_PARSE_FAILED for invalid JSON', () => {
    expect(() => parseConfigJson('not json')).toThrow(RepoError);
    try {
      parseConfigJson('not json');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_PARSE_FAILED');
    }
  });

  it('throws CONFIG_VALIDATION_FAILED for schema violations', () => {
    const json = JSON.stringify({name: 'test'});
    expect(() => parseConfigJson(json)).toThrow(RepoError);
    try {
      parseConfigJson(json);
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_VALIDATION_FAILED');
    }
  });

  it('throws ENV_NOT_SET for unresolvable env values', () => {
    delete process.env['NONEXISTENT'];
    const json = JSON.stringify({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {provider: 'anthropic', model: 'env:NONEXISTENT'},
      },
    });
    expect(() => parseConfigJson(json)).toThrow(RepoError);
    try {
      parseConfigJson(json);
    } catch (err) {
      expect((err as RepoError).code).toBe('ENV_NOT_SET');
    }
  });

  it('keeps env: values as literals when skipEnvResolution is set', () => {
    delete process.env['NONEXISTENT'];
    const json = JSON.stringify({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {provider: 'anthropic', model: 'env:NONEXISTENT'},
      },
    });
    // Without flag — throws
    expect(() => parseConfigJson(json)).toThrow(RepoError);
    // With flag — succeeds, keeps the literal
    const config = parseConfigJson(json, {skipEnvResolution: true});
    expect(config.models?.['main']?.model).toBe('env:NONEXISTENT');
  });
});
