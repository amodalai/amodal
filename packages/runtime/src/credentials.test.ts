/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {EnvCredentialResolver, ScopeSecretsResolver, ChainResolver} from './credentials.js';

describe('EnvCredentialResolver', () => {
  const resolver = new EnvCredentialResolver();

  beforeEach(() => {
    process.env['TEST_ENV_KEY'] = 'env-value-123';
  });

  afterEach(() => {
    delete process.env['TEST_ENV_KEY'];
  });

  it('resolves env:KEY from process.env', async () => {
    const result = await resolver.resolve('env:TEST_ENV_KEY');
    expect(result).toBe('env-value-123');
  });

  it('returns undefined for non-env: prefixes', async () => {
    const result = await resolver.resolve('scope:SOME_KEY');
    expect(result).toBeUndefined();
  });

  it('returns undefined for an env:KEY that does not exist', async () => {
    const result = await resolver.resolve('env:NONEXISTENT_KEY_XYZ');
    expect(result).toBeUndefined();
  });

  it('returns undefined for a plain string with no prefix', async () => {
    const result = await resolver.resolve('plain-literal');
    expect(result).toBeUndefined();
  });
});

describe('ScopeSecretsResolver', () => {
  const secrets = {
    API_KEY: 'secret-abc',
    WEBHOOK_SECRET: 'webhook-xyz',
  };
  const resolver = new ScopeSecretsResolver(secrets);

  it('resolves scope:KEY from the secrets map', async () => {
    const result = await resolver.resolve('scope:API_KEY');
    expect(result).toBe('secret-abc');
  });

  it('resolves another key from the secrets map', async () => {
    const result = await resolver.resolve('scope:WEBHOOK_SECRET');
    expect(result).toBe('webhook-xyz');
  });

  it('returns undefined for non-scope: prefixes', async () => {
    const result = await resolver.resolve('env:API_KEY');
    expect(result).toBeUndefined();
  });

  it('returns undefined for missing keys', async () => {
    const result = await resolver.resolve('scope:MISSING_KEY');
    expect(result).toBeUndefined();
  });

  it('returns undefined for a plain string with no prefix', async () => {
    const result = await resolver.resolve('plain-literal');
    expect(result).toBeUndefined();
  });
});

describe('ChainResolver', () => {
  beforeEach(() => {
    process.env['CHAIN_TEST_KEY'] = 'env-chain-value';
  });

  afterEach(() => {
    delete process.env['CHAIN_TEST_KEY'];
  });

  it('tries resolvers in order and returns first match', async () => {
    const secrets = {MY_SECRET: 'scope-value'};
    const chain = new ChainResolver([
      new EnvCredentialResolver(),
      new ScopeSecretsResolver(secrets),
    ]);

    // env: should be matched by EnvCredentialResolver (first)
    const envResult = await chain.resolve('env:CHAIN_TEST_KEY');
    expect(envResult).toBe('env-chain-value');

    // scope: should fall through to ScopeSecretsResolver (second)
    const scopeResult = await chain.resolve('scope:MY_SECRET');
    expect(scopeResult).toBe('scope-value');
  });

  it('falls back to literal string when no resolver matches a prefix', async () => {
    const chain = new ChainResolver([
      new EnvCredentialResolver(),
      new ScopeSecretsResolver({}),
    ]);

    const result = await chain.resolve('some-literal-value');
    expect(result).toBe('some-literal-value');
  });

  it('returns the first non-undefined result and skips later resolvers', async () => {
    // Both resolvers would claim to handle 'env:' — but only the first
    // match is used. We verify by putting a resolver that always returns
    // a value first in the chain.
    const alwaysResolvesFirst = {
      resolve: async (_ref: string): Promise<string | undefined> => 'first-resolver',
    };
    const alwaysResolvesSecond = {
      resolve: async (_ref: string): Promise<string | undefined> => 'second-resolver',
    };

    const chain = new ChainResolver([alwaysResolvesFirst, alwaysResolvesSecond]);
    const result = await chain.resolve('anything');
    expect(result).toBe('first-resolver');
  });

  it('works with an empty resolver list and returns ref as literal', async () => {
    const chain = new ChainResolver([]);
    const result = await chain.resolve('literal-passthrough');
    expect(result).toBe('literal-passthrough');
  });
});
