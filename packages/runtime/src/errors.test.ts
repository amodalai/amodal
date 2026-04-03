/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {
  AmodalError,
  ProviderError,
  RateLimitError,
  ProviderTimeoutError,
  ToolExecutionError,
  StoreError,
  ConnectionError,
  SessionError,
  CompactionError,
  ConfigError,
} from './errors.js';
import type {Result} from './errors.js';

describe('AmodalError', () => {
  it('carries code, message, and context', () => {
    const err = new AmodalError('TEST_CODE', 'something broke', {foo: 'bar'});
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('something broke');
    expect(err.context).toEqual({foo: 'bar'});
    expect(err.name).toBe('AmodalError');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults context to empty object', () => {
    const err = new AmodalError('X', 'msg');
    expect(err.context).toEqual({});
  });

  it('preserves cause chain', () => {
    const cause = new Error('root cause');
    const err = new AmodalError('X', 'wrapped', {}, cause);
    expect(err.cause).toBe(cause);
  });

  it('serializes to JSON with cause', () => {
    const cause = new Error('root');
    const err = new AmodalError('TEST', 'msg', {k: 1}, cause);
    const json = err.toJSON();
    expect(json).toEqual({
      name: 'AmodalError',
      code: 'TEST',
      message: 'msg',
      context: {k: 1},
      cause: {name: 'Error', message: 'root'},
    });
  });

  it('serializes to JSON without cause', () => {
    const err = new AmodalError('TEST', 'msg');
    const json = err.toJSON();
    expect(json).not.toHaveProperty('cause');
  });

  it('serializes non-Error cause as string', () => {
    const err = new AmodalError('TEST', 'msg', {}, 'string cause');
    expect(err.toJSON()['cause']).toBe('string cause');
  });
});

describe('ProviderError', () => {
  it('has correct code and provider fields', () => {
    const err = new ProviderError('API failed', {provider: 'anthropic', statusCode: 500});
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.provider).toBe('anthropic');
    expect(err.statusCode).toBe(500);
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('ProviderError');
    expect(err).toBeInstanceOf(AmodalError);
    expect(err.context['provider']).toBe('anthropic');
    expect(err.context['statusCode']).toBe(500);
  });

  it('defaults retryable to false', () => {
    const err = new ProviderError('fail', {provider: 'openai'});
    expect(err.retryable).toBe(false);
  });
});

describe('RateLimitError', () => {
  it('is a retryable ProviderError with 429 status', () => {
    const err = new RateLimitError('slow down', {provider: 'anthropic', retryAfterMs: 5000});
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.name).toBe('RateLimitError');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(AmodalError);
  });
});

describe('ProviderTimeoutError', () => {
  it('is a retryable ProviderError', () => {
    const err = new ProviderTimeoutError('timed out', {provider: 'google'});
    expect(err.retryable).toBe(true);
    expect(err.name).toBe('ProviderTimeoutError');
    expect(err).toBeInstanceOf(ProviderError);
  });
});

describe('ToolExecutionError', () => {
  it('carries tool name and call ID in context', () => {
    const err = new ToolExecutionError('tool crashed', {
      toolName: 'fetch_deals',
      callId: 'call_123',
      context: {args: {limit: 10}},
    });
    expect(err.code).toBe('TOOL_EXECUTION_ERROR');
    expect(err.toolName).toBe('fetch_deals');
    expect(err.callId).toBe('call_123');
    expect(err.context['toolName']).toBe('fetch_deals');
    expect(err.context['args']).toEqual({limit: 10});
    expect(err).toBeInstanceOf(AmodalError);
  });
});

describe('StoreError', () => {
  it('carries store name and operation', () => {
    const cause = new Error('PGLite crash');
    const err = new StoreError('write failed', {
      store: 'alerts',
      operation: 'put',
      cause,
      context: {key: 'alert-1'},
    });
    expect(err.code).toBe('STORE_ERROR');
    expect(err.store).toBe('alerts');
    expect(err.operation).toBe('put');
    expect(err.context['key']).toBe('alert-1');
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(AmodalError);
  });
});

describe('ConnectionError', () => {
  it('carries connection name and action', () => {
    const err = new ConnectionError('auth failed', {
      connection: 'typefully',
      action: 'POST /social-sets',
    });
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.connection).toBe('typefully');
    expect(err.action).toBe('POST /social-sets');
    expect(err).toBeInstanceOf(AmodalError);
  });
});

describe('SessionError', () => {
  it('carries session ID', () => {
    const err = new SessionError('session expired', {
      sessionId: 'sess_abc',
      context: {tenantId: 'tenant_1'},
    });
    expect(err.code).toBe('SESSION_ERROR');
    expect(err.sessionId).toBe('sess_abc');
    expect(err.context['tenantId']).toBe('tenant_1');
    expect(err).toBeInstanceOf(AmodalError);
  });
});

describe('CompactionError', () => {
  it('carries stage', () => {
    const err = new CompactionError('summarization failed', {stage: 'pre_summarize'});
    expect(err.code).toBe('COMPACTION_ERROR');
    expect(err.stage).toBe('pre_summarize');
    expect(err).toBeInstanceOf(AmodalError);
  });
});

describe('ConfigError', () => {
  it('carries config key', () => {
    const err = new ConfigError('missing API key', {
      key: 'providers.primary.apiKey',
      context: {checked: ['env:ANTHROPIC_API_KEY', 'amodal.json']},
    });
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.key).toBe('providers.primary.apiKey');
    expect(err.context['checked']).toEqual(['env:ANTHROPIC_API_KEY', 'amodal.json']);
    expect(err).toBeInstanceOf(AmodalError);
  });
});

describe('unique error codes', () => {
  it('each subclass has a distinct code', () => {
    const codes = [
      new ProviderError('', {provider: ''}),
      new ToolExecutionError('', {toolName: '', callId: ''}),
      new StoreError('', {store: '', operation: ''}),
      new ConnectionError('', {connection: '', action: ''}),
      new SessionError('', {sessionId: ''}),
      new CompactionError('', {stage: ''}),
      new ConfigError('', {key: ''}),
    ].map(e => e.code);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('Result type', () => {
  it('narrows on ok check', () => {
    const success: Result<number, StoreError> = {ok: true, value: 42};
    const failure: Result<number, StoreError> = {
      ok: false,
      error: new StoreError('not found', {store: 'alerts', operation: 'get'}),
    };

    if (success.ok) {
      expect(success.value).toBe(42);
    }
    if (!failure.ok) {
      expect(failure.error.store).toBe('alerts');
    }
  });
});
