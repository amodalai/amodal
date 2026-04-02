/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {fetchUserContext, _parseUserContextSpecForTesting as parseSpec} from './user-context-fetcher.js';
import type {AgentBundle} from '@amodalai/core';
import type {ConnectionsMap} from '@amodalai/core';

function makeRepo(userContext?: string): AgentBundle {
  return {
    source: 'local',
    origin: '/test',
    config: {
      name: 'test',
      version: '1.0.0',
      userContext,
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
      },
    },
    connections: new Map(),
    skills: [],
    agents: {subagents: []},
    automations: [],
    knowledge: [],
    evals: [],
    tools: [],
    stores: [],
  };
}

describe('parseUserContextSpec', () => {
  it('should parse "GET crm/users/me"', () => {
    const result = parseSpec('GET crm/users/me');
    expect(result).toEqual({
      method: 'GET',
      connection: 'crm',
      path: '/users/me',
    });
  });

  it('should parse "POST api/auth"', () => {
    const result = parseSpec('POST api/auth');
    expect(result).toEqual({
      method: 'POST',
      connection: 'api',
      path: '/auth',
    });
  });

  it('should handle connection with no path', () => {
    const result = parseSpec('GET crm');
    expect(result).toEqual({
      method: 'GET',
      connection: 'crm',
      path: '/',
    });
  });

  it('should return null for empty string', () => {
    const result = parseSpec('');
    expect(result).toBeNull();
  });

  it('should return null for single word', () => {
    const result = parseSpec('GET');
    expect(result).toBeNull();
  });
});

describe('fetchUserContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty object when no userContext configured', async () => {
    const repo = makeRepo();
    const result = await fetchUserContext(repo, 'token', {});
    expect(result).toEqual({});
  });

  it('should return empty object when connection not found', async () => {
    const repo = makeRepo('GET unknown/users/me');
    const result = await fetchUserContext(repo, 'token', {});
    expect(result).toEqual({});
  });

  it('should return empty object when base_url missing', async () => {
    const repo = makeRepo('GET crm/users/me');
    const connMap: ConnectionsMap = {
      crm: {no_base_url: true},
    };
    const result = await fetchUserContext(repo, 'token', connMap);
    expect(result).toEqual({});
  });

  it('should fetch user context successfully', async () => {
    const repo = makeRepo('GET crm/users/me');
    const connMap: ConnectionsMap = {
      crm: {base_url: 'https://api.example.com'},
    };

    const mockResponse = {role: 'admin', name: 'Test User'};
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {status: 200}),
    );

    const result = await fetchUserContext(repo, 'my-token', connMap);
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/users/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
        }),
      }),
    );
  });

  it('should return empty object on HTTP error', async () => {
    const repo = makeRepo('GET crm/users/me');
    const connMap: ConnectionsMap = {
      crm: {base_url: 'https://api.example.com'},
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', {status: 404}),
    );

    const result = await fetchUserContext(repo, 'token', connMap);
    expect(result).toEqual({});
  });

  it('should return empty object on fetch error', async () => {
    const repo = makeRepo('GET crm/users/me');
    const connMap: ConnectionsMap = {
      crm: {base_url: 'https://api.example.com'},
    };

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const result = await fetchUserContext(repo, 'token', connMap);
    expect(result).toEqual({});
  });
});
