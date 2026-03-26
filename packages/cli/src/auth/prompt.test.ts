/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {PackageAuth} from '@amodalai/core';

const mockFindMissingEnvVars = vi.fn<(path: string, required: string[]) => Promise<string[]>>();
const mockUpsertEnvEntries = vi.fn<(path: string, entries: Record<string, string>) => Promise<void>>();
const mockPrompts = vi.fn();

vi.mock('@amodalai/core', () => ({
  findMissingEnvVars: (...args: unknown[]) => mockFindMissingEnvVars(args[0] as string, args[1] as string[]),
  upsertEnvEntries: (...args: unknown[]) => mockUpsertEnvEntries(args[0] as string, args[1] as Record<string, string>),
}));

vi.mock('prompts', () => ({
  default: (...args: unknown[]) => mockPrompts(...args),
}));

import {getRequiredEnvVars, promptForCredentials} from './prompt.js';

describe('getRequiredEnvVars', () => {
  it('returns envVars keys for bearer auth', () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {API_TOKEN: 'Your API token'},
    };
    expect(getRequiredEnvVars(auth)).toEqual(['API_TOKEN']);
  });

  it('returns envVars keys for oauth2 auth', () => {
    const auth: PackageAuth = {
      type: 'oauth2',
      authorizeUrl: 'https://example.com/auth',
      tokenUrl: 'https://example.com/token',
      envVars: {ACCESS_TOKEN: 'Access token', REFRESH_TOKEN: 'Refresh token'},
    };
    expect(getRequiredEnvVars(auth)).toEqual(['ACCESS_TOKEN', 'REFRESH_TOKEN']);
  });

  it('returns envVars keys for api_key auth', () => {
    const auth: PackageAuth = {
      type: 'api_key',
      envVars: {MY_API_KEY: 'API key'},
    };
    expect(getRequiredEnvVars(auth)).toEqual(['MY_API_KEY']);
  });

  it('extracts $VAR references from api_key headers', () => {
    const auth: PackageAuth = {
      type: 'api_key',
      headers: {'X-Api-Key': '$SECRET_KEY'},
      envVars: {},
    };
    expect(getRequiredEnvVars(auth)).toEqual(['SECRET_KEY']);
  });

  it('extracts ${VAR} references from api_key headers', () => {
    const auth: PackageAuth = {
      type: 'api_key',
      headers: {Authorization: 'ApiKey ${API_KEY_VAR}'},
    };
    expect(getRequiredEnvVars(auth)).toEqual(['API_KEY_VAR']);
  });

  it('deduplicates vars from envVars and headers', () => {
    const auth: PackageAuth = {
      type: 'api_key',
      headers: {'X-Key': '$MY_KEY'},
      envVars: {MY_KEY: 'The key'},
    };
    expect(getRequiredEnvVars(auth)).toEqual(['MY_KEY']);
  });

  it('returns empty for auth with no envVars', () => {
    const auth: PackageAuth = {
      type: 'bearer',
    };
    expect(getRequiredEnvVars(auth)).toEqual([]);
  });
});

describe('promptForCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when no credentials required', async () => {
    const auth: PackageAuth = {type: 'bearer'};
    const result = await promptForCredentials({
      auth,
      envFilePath: '/tmp/.env',
    });
    expect(result.summary).toBe('No credentials required');
    expect(result.credentials).toEqual({});
  });

  it('returns summary when all credentials already set', async () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {TOKEN: 'token'},
    };
    mockFindMissingEnvVars.mockResolvedValue([]);

    const result = await promptForCredentials({
      auth,
      envFilePath: '/tmp/.env',
    });
    expect(result.summary).toBe('All credentials already set');
  });

  it('returns missing vars in dryRun mode without prompting', async () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {TOKEN_A: 'a', TOKEN_B: 'b'},
    };
    mockFindMissingEnvVars.mockResolvedValue(['TOKEN_A', 'TOKEN_B']);

    const result = await promptForCredentials({
      auth,
      envFilePath: '/tmp/.env',
      dryRun: true,
    });
    expect(result.summary).toBe('Missing credentials: TOKEN_A, TOKEN_B');
    expect(mockPrompts).not.toHaveBeenCalled();
  });

  it('prompts for missing vars with password type', async () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {MY_TOKEN: 'Your token'},
    };
    mockFindMissingEnvVars.mockResolvedValue(['MY_TOKEN']);
    mockPrompts.mockResolvedValue({value: 'secret123'});
    mockUpsertEnvEntries.mockResolvedValue(undefined);

    const result = await promptForCredentials({
      auth,
      envFilePath: '/tmp/.env',
    });

    expect(mockPrompts).toHaveBeenCalledWith(
      expect.objectContaining({type: 'password', name: 'value'}),
    );
    expect(result.credentials).toEqual({MY_TOKEN: 'secret123'});
    expect(result.summary).toBe('Set 1 credential');
  });

  it('includes description in prompt message', async () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {API_KEY: 'Your Acme API key'},
    };
    mockFindMissingEnvVars.mockResolvedValue(['API_KEY']);
    mockPrompts.mockResolvedValue({value: 'key123'});
    mockUpsertEnvEntries.mockResolvedValue(undefined);

    await promptForCredentials({auth, envFilePath: '/tmp/.env'});

    expect(mockPrompts).toHaveBeenCalledWith(
      expect.objectContaining({message: 'API_KEY (Your Acme API key)'}),
    );
  });

  it('handles user cancellation gracefully', async () => {
    const auth: PackageAuth = {
      type: 'api_key',
      envVars: {KEY_A: 'a', KEY_B: 'b'},
    };
    mockFindMissingEnvVars.mockResolvedValue(['KEY_A', 'KEY_B']);
    mockPrompts
      .mockResolvedValueOnce({value: 'val_a'})
      .mockResolvedValueOnce({});  // Ctrl+C — no value

    const result = await promptForCredentials({
      auth,
      envFilePath: '/tmp/.env',
    });

    expect(result.summary).toContain('Cancelled');
    expect(result.summary).toContain('1 of 2');
  });

  it('writes collected credentials to env file', async () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {A: 'first', B: 'second'},
    };
    mockFindMissingEnvVars.mockResolvedValue(['A', 'B']);
    mockPrompts
      .mockResolvedValueOnce({value: 'val_a'})
      .mockResolvedValueOnce({value: 'val_b'});
    mockUpsertEnvEntries.mockResolvedValue(undefined);

    await promptForCredentials({auth, envFilePath: '/tmp/test.env'});

    expect(mockUpsertEnvEntries).toHaveBeenCalledWith(
      '/tmp/test.env',
      {A: 'val_a', B: 'val_b'},
    );
  });
});
