/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {createServer} from 'node:http';
import type {Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {URL, URLSearchParams} from 'node:url';
import open from 'open';

import type {AuthResult} from './types.js';

export type OAuth2ErrorCode =
  | 'SERVER_FAILED'
  | 'BROWSER_FAILED'
  | 'TIMEOUT'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'CALLBACK_ERROR'
  | 'STATE_MISMATCH';

export class OAuth2Error extends Error {
  readonly code: OAuth2ErrorCode;

  constructor(code: OAuth2ErrorCode, message: string, cause?: unknown) {
    super(message, {cause});
    this.name = 'OAuth2Error';
    this.code = code;
  }
}

export interface OAuth2Options {
  authorizeUrl: string;
  tokenUrl: string;
  scopes?: string[];
  envVars?: Record<string, string>;
  clientId: string;
  clientSecret?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

interface CallbackServerResult {
  server: Server;
  port: number;
  codePromise: Promise<{code: string; state: string}>;
}

/**
 * Start a local HTTP server that listens for the OAuth2 callback.
 */
export function startCallbackServer(): Promise<CallbackServerResult> {
  return new Promise((resolve, reject) => {
    let resolveCode: (value: {code: string; state: string}) => void;
    let rejectCode: (reason: Error) => void;
    const codePromise = new Promise<{code: string; state: string}>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          const description = url.searchParams.get('error_description') ?? error;
          res.writeHead(200, {'Content-Type': 'text/html'});
          res.end('<html><body><h1>Authorization Failed</h1><p>You can close this window.</p></body></html>');
          rejectCode(new OAuth2Error('CALLBACK_ERROR', `OAuth2 error: ${description}`));
          return;
        }

        if (!code || !state) {
          res.writeHead(400, {'Content-Type': 'text/html'});
          res.end('<html><body><h1>Missing Parameters</h1></body></html>');
          rejectCode(new OAuth2Error('CALLBACK_ERROR', 'Missing code or state parameter'));
          return;
        }

        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<html><body><h1>Authorization Complete</h1><p>You can close this window.</p></body></html>');
        resolveCode({code, state});
      } catch (err) {
        res.writeHead(500);
        res.end('Internal error');
        rejectCode(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new OAuth2Error('SERVER_FAILED', 'Failed to get server port'));
        return;
      }
      resolve({server, port: addr.port, codePromise});
    });

    server.on('error', (err) => {
      reject(new OAuth2Error('SERVER_FAILED', 'Failed to start callback server', err));
    });
  });
}

/**
 * Build the OAuth2 authorize URL.
 */
export function buildAuthorizeUrl(
  baseUrl: string,
  options: OAuth2Options,
  port: number,
  state: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', `http://127.0.0.1:${port}/callback`);
  url.searchParams.set('state', state);
  if (options.scopes && options.scopes.length > 0) {
    url.searchParams.set('scope', options.scopes.join(' '));
  }
  return url.toString();
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  tokenUrl: string,
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret?: string,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new OAuth2Error(
      'TOKEN_EXCHANGE_FAILED',
      `Token exchange failed: HTTP ${response.status}${text ? ` — ${text}` : ''}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Map token response fields to env var names.
 */
export function mapTokensToEnvVars(
  tokens: Record<string, unknown>,
  envVars?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  if (envVars && Object.keys(envVars).length > 0) {
    // envVars maps envVarName → description (for prompting)
    // Token fields: access_token, refresh_token, etc.
    // Convention: env var name hints at which token field
    for (const envVarName of Object.keys(envVars)) {
      const lower = envVarName.toLowerCase();
      if (lower.includes('refresh') && typeof tokens['refresh_token'] === 'string') {
        result[envVarName] = tokens['refresh_token'];
      } else if (lower.includes('access') && typeof tokens['access_token'] === 'string') {
        result[envVarName] = tokens['access_token'];
      } else if (typeof tokens['access_token'] === 'string') {
        // Default: map to access_token
        result[envVarName] = tokens['access_token'];
      }
    }
  } else {
    // Default mapping
    if (typeof tokens['access_token'] === 'string') {
      result['OAUTH_ACCESS_TOKEN'] = tokens['access_token'];
    }
    if (typeof tokens['refresh_token'] === 'string') {
      result['OAUTH_REFRESH_TOKEN'] = tokens['refresh_token'];
    }
  }

  return result;
}

/**
 * Run the full OAuth2 authorization code flow.
 */
export async function runOAuth2Flow(options: OAuth2Options): Promise<AuthResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let server: Server | undefined;

  try {
    const serverResult = await startCallbackServer();
    server = serverResult.server;
    const {port, codePromise} = serverResult;

    const state = randomUUID();
    const authorizeUrl = buildAuthorizeUrl(options.authorizeUrl, options, port, state);
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    // Try to open browser, fall back to printing URL
    try {
      await open(authorizeUrl);
    } catch {
      process.stderr.write(`\nOpen this URL in your browser to authorize:\n${authorizeUrl}\n\n`);
    }

    // Wait for callback or timeout
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new OAuth2Error('TIMEOUT', `OAuth2 flow timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const callbackResult = await Promise.race([codePromise, timeoutPromise]);

    // Verify state (CSRF protection)
    if (callbackResult.state !== state) {
      throw new OAuth2Error('STATE_MISMATCH', 'OAuth2 state parameter mismatch');
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      options.tokenUrl,
      callbackResult.code,
      redirectUri,
      options.clientId,
      options.clientSecret,
    );

    const credentials = mapTokensToEnvVars(tokens, options.envVars);

    return {
      credentials,
      summary: `OAuth2 authorization complete. ${Object.keys(credentials).length} token${Object.keys(credentials).length === 1 ? '' : 's'} obtained`,
    };
  } finally {
    if (server) {
      server.close();
    }
  }
}
