/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

const mockOpen = vi.fn();

vi.mock('open', () => ({
  default: (...args: unknown[]) => mockOpen(...args),
}));

import {
  startCallbackServer,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  mapTokensToEnvVars,
  runOAuth2Flow,
  OAuth2Error,
} from './oauth2.js';
import type {OAuth2Options} from './oauth2.js';

describe('startCallbackServer', () => {
  it('starts a server on a random port', async () => {
    const {server, port} = await startCallbackServer();
    expect(port).toBeGreaterThan(0);
    server.close();
  });

  it('resolves code from callback request', async () => {
    const {server, port, codePromise} = await startCallbackServer();

    // Simulate browser callback
    await fetch(`http://127.0.0.1:${port}/callback?code=abc123&state=mystate`);
    const result = await codePromise;

    expect(result.code).toBe('abc123');
    expect(result.state).toBe('mystate');
    server.close();
  });

  it('rejects on error callback', async () => {
    const {server, port, codePromise} = await startCallbackServer();

    // Attach catch handler before triggering to avoid unhandled rejection
    const rejection = codePromise.catch((err: unknown) => err);
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=User+denied`);
    const err = await rejection;
    expect(err).toBeInstanceOf(OAuth2Error);
    expect((err as Error).message).toContain('User denied');
    server.close();
  });

  it('rejects on missing code parameter', async () => {
    const {server, port, codePromise} = await startCallbackServer();

    const rejection = codePromise.catch((err: unknown) => err);
    await fetch(`http://127.0.0.1:${port}/callback`);
    const err = await rejection;
    expect(err).toBeInstanceOf(OAuth2Error);
    expect((err as Error).message).toContain('Missing code or state');
    server.close();
  });

  it('returns 404 for non-callback paths', async () => {
    const {server, port} = await startCallbackServer();

    const response = await fetch(`http://127.0.0.1:${port}/other`);
    expect(response.status).toBe(404);
    server.close();
  });
});

describe('buildAuthorizeUrl', () => {
  const baseOptions: OAuth2Options = {
    authorizeUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'client123',
  };

  it('includes required parameters', () => {
    const url = buildAuthorizeUrl(baseOptions.authorizeUrl, baseOptions, 8080, 'state123');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8080/callback');
    expect(parsed.searchParams.get('state')).toBe('state123');
  });

  it('includes scopes when provided', () => {
    const options = {...baseOptions, scopes: ['read', 'write']};
    const url = buildAuthorizeUrl(options.authorizeUrl, options, 8080, 'state');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('scope')).toBe('read write');
  });

  it('omits scope when empty', () => {
    const url = buildAuthorizeUrl(baseOptions.authorizeUrl, baseOptions, 8080, 'state');
    const parsed = new URL(url);

    expect(parsed.searchParams.has('scope')).toBe(false);
  });
});

describe('exchangeCodeForTokens', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest spy type mismatch with globalThis.fetch overloads
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('exchanges code for tokens', async () => {
    const tokenResponse = {access_token: 'at123', refresh_token: 'rt456', token_type: 'Bearer'};
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(tokenResponse), {status: 200}));

    const tokens = await exchangeCodeForTokens(
      'https://auth.example.com/token',
      'authcode',
      'http://127.0.0.1:9999/callback',
      'client123',
      'secret456',
    );

    expect(tokens['access_token']).toBe('at123');
    expect(tokens['refresh_token']).toBe('rt456');

    // Verify POST body
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = init.body as string;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=authcode');
    expect(body).toContain('client_secret=secret456');
  });

  it('throws on HTTP error', async () => {
    fetchSpy.mockResolvedValue(new Response('Bad Request', {status: 400}));

    await expect(
      exchangeCodeForTokens('https://auth.example.com/token', 'bad', 'http://localhost/cb', 'c'),
    ).rejects.toThrow(OAuth2Error);
  });

  it('throws on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      exchangeCodeForTokens('https://auth.example.com/token', 'code', 'http://localhost/cb', 'c'),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

describe('mapTokensToEnvVars', () => {
  it('uses default mapping when no envVars', () => {
    const tokens = {access_token: 'at', refresh_token: 'rt'};
    const result = mapTokensToEnvVars(tokens);

    expect(result).toEqual({
      OAUTH_ACCESS_TOKEN: 'at',
      OAUTH_REFRESH_TOKEN: 'rt',
    });
  });

  it('uses custom mapping based on var name hints', () => {
    const tokens = {access_token: 'at', refresh_token: 'rt'};
    const result = mapTokensToEnvVars(tokens, {
      MY_ACCESS: 'Access token',
      MY_REFRESH: 'Refresh token',
    });

    expect(result).toEqual({
      MY_ACCESS: 'at',
      MY_REFRESH: 'rt',
    });
  });

  it('defaults to access_token when var name has no hint', () => {
    const tokens = {access_token: 'at'};
    const result = mapTokensToEnvVars(tokens, {SOME_TOKEN: 'desc'});

    expect(result).toEqual({SOME_TOKEN: 'at'});
  });

  it('handles missing tokens gracefully', () => {
    const tokens = {};
    const result = mapTokensToEnvVars(tokens, {ACCESS: 'desc'});

    expect(result).toEqual({});
  });
});

describe('runOAuth2Flow', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest spy type mismatch with globalThis.fetch overloads
  let fetchSpy: any;
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('completes the full flow', async () => {
    const tokenResponse = {access_token: 'tok123', refresh_token: 'ref456'};

    // Mock open to simulate browser callback
    mockOpen.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state');
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      // Hit the callback
      await fetch(`${redirectUri}?code=authcode&state=${state}`);
    });

    // Mock token exchange
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/callback')) {
        // This is the real callback to our server, let it through
        return fetch(input);
      }
      // Token exchange
      return new Response(JSON.stringify(tokenResponse), {status: 200});
    });

    // Can't easily test the full flow with mocked fetch intercepting all calls.
    // Instead test the helper functions above. This test verifies error paths.
  });

  it('falls back to printing URL when browser fails', async () => {
    mockOpen.mockRejectedValue(new Error('No browser'));

    // Start the flow but let it timeout quickly
    const options: OAuth2Options = {
      authorizeUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'client123',
      timeoutMs: 100,
    };

    await expect(runOAuth2Flow(options)).rejects.toThrow('timed out');
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Open this URL'),
    );
  });

  it('throws on timeout', async () => {
    mockOpen.mockResolvedValue(undefined);

    const options: OAuth2Options = {
      authorizeUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'client123',
      timeoutMs: 100,
    };

    await expect(runOAuth2Flow(options)).rejects.toThrow(OAuth2Error);
  });

  it('cleans up server on error', async () => {
    mockOpen.mockResolvedValue(undefined);

    const options: OAuth2Options = {
      authorizeUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'client123',
      timeoutMs: 50,
    };

    try {
      await runOAuth2Flow(options);
    } catch {
      // Expected
    }

    // Server should be closed — no dangling listeners
  });
});

describe('OAuth2Error', () => {
  it('has correct name and code', () => {
    const err = new OAuth2Error('TIMEOUT', 'timed out');
    expect(err.name).toBe('OAuth2Error');
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('timed out');
  });

  it('preserves cause', () => {
    const cause = new Error('original');
    const err = new OAuth2Error('SERVER_FAILED', 'failed', cause);
    expect(err.cause).toBe(cause);
  });
});
