/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {writeFile, readFile, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {Server} from 'node:http';
import {homedir} from 'node:os';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';

import type {CommandModule} from 'yargs';
import open from 'open';

const DEFAULT_PLATFORM_URL = 'https://api.amodalai.com';
const DEFAULT_ADMIN_UI_URL = 'https://app.amodalai.com';
const RC_FILE = '.amodalrc';
const LOGIN_TIMEOUT_MS = 120_000;

export interface LoginOptions {
  platformUrl?: string;
  adminUrl?: string;
}

interface RcFile {
  platform?: {
    url: string;
    token: string;
    refreshToken?: string;
  };
}

export async function readRcFile(): Promise<RcFile> {
  const rcPath = path.join(homedir(), RC_FILE);
  try {
    const content = await readFile(rcPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(content) as RcFile;
  } catch {
    return {};
  }
}

async function writeRcFile(rc: RcFile): Promise<void> {
  const rcPath = path.join(homedir(), RC_FILE);
  await mkdir(path.dirname(rcPath), {recursive: true});
  await writeFile(rcPath, JSON.stringify(rc, null, 2) + '\n', {mode: 0o600});
}

/**
 * Start a local callback server that receives the token from the browser.
 */
function startCallbackServer(): Promise<{
  server: Server;
  port: number;
  tokenPromise: Promise<{token: string; refreshToken: string; state: string}>;
}> {
  return new Promise((resolve, reject) => {
    let resolveToken: (value: {token: string; refreshToken: string; state: string}) => void;
    let rejectToken: (reason: Error) => void;
    const tokenPromise = new Promise<{token: string; refreshToken: string; state: string}>(
      (res, rej) => {
        resolveToken = res;
        rejectToken = rej;
      },
    );

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const token = url.searchParams.get('token');
        const refreshToken = url.searchParams.get('refresh_token') ?? '';
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, {'Content-Type': 'text/html'});
          res.end(
            '<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
              '<div><h1>Login Failed</h1><p>You can close this window.</p></div></body></html>',
          );
          rejectToken(new Error(`Login error: ${error}`));
          return;
        }

        if (!token || !state) {
          res.writeHead(400, {'Content-Type': 'text/html'});
          res.end(
            '<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
              '<div><h1>Missing Parameters</h1></div></body></html>',
          );
          rejectToken(new Error('Missing token or state parameter'));
          return;
        }

        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end(
          '<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
            '<div><h1>Login Successful</h1><p>You can close this window and return to the terminal.</p></div></body></html>',
        );
        resolveToken({token, refreshToken, state});
      } catch (err) {
        res.writeHead(500);
        res.end('Internal error');
        rejectToken(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to get callback server port'));
        return;
      }
      resolve({server, port: addr.port, tokenPromise});
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });
  });
}

/**
 * Log in to the amodal platform via browser OAuth.
 *
 * Opens the admin UI's /cli-auth page in the browser. After the user
 * authenticates via Supabase, the admin UI redirects the token back
 * to a local callback server.
 *
 * Returns 0 on success, 1 on error.
 */
export async function runLogin(options: LoginOptions = {}): Promise<number> {
  const platformUrl = options.platformUrl ?? process.env['PLATFORM_API_URL'] ?? DEFAULT_PLATFORM_URL;
  const adminUrl = options.adminUrl ?? process.env['ADMIN_UI_URL'] ?? DEFAULT_ADMIN_UI_URL;

  // Check if already logged in
  const rc = await readRcFile();
  if (rc.platform?.url === platformUrl && rc.platform.token) {
    process.stderr.write(`[login] Already logged in to ${platformUrl}\n`);
    process.stderr.write('[login] Run `amodal logout` first, or use --platform-url for a different instance.\n');
    return 0;
  }

  // Start local callback server
  let server: Server | undefined;
  try {
    const {server: srv, port, tokenPromise} = await startCallbackServer();
    server = srv;
    // Prevent unhandled rejection if tokenPromise rejects after we've moved on
    tokenPromise.catch(() => {});

    const state = randomUUID();

    // Build the admin UI login page URL
    const loginUrl = new URL(`${adminUrl}/cli-auth`);
    loginUrl.searchParams.set('port', String(port));
    loginUrl.searchParams.set('state', state);

    // Open browser
    process.stderr.write('[login] Opening browser for authentication...\n');
    try {
      await open(loginUrl.toString());
    } catch {
      process.stderr.write(`\nOpen this URL in your browser to log in:\n${loginUrl.toString()}\n\n`);
    }

    process.stderr.write('[login] Waiting for browser login...\n');

    // Wait for callback or timeout
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`Login timed out after ${LOGIN_TIMEOUT_MS / 1000}s`));
      }, LOGIN_TIMEOUT_MS);
    });

    const result = await Promise.race([tokenPromise, timeoutPromise]);

    // Verify CSRF state
    if (result.state !== state) {
      process.stderr.write('[login] State mismatch — possible CSRF attack. Login aborted.\n');
      return 1;
    }

    // Verify the token works by calling /api/me
    process.stderr.write('[login] Verifying credentials...\n');
    const meResponse = await fetch(`${platformUrl}/api/me`, {
      headers: {Authorization: `Bearer ${result.token}`},
    });

    if (!meResponse.ok) {
      process.stderr.write('[login] Token verification failed. Please try again.\n');
      return 1;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const me = (await meResponse.json()) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const user = me['user'] as Record<string, string> | null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const org = me['org'] as Record<string, string> | null;

    // Save credentials
    rc.platform = {
      url: platformUrl,
      token: result.token,
      refreshToken: result.refreshToken || undefined,
    };
    await writeRcFile(rc);

    const identity = user?.['email'] ?? user?.['name'] ?? 'unknown';
    const orgName = org?.['name'] ?? '';
    process.stderr.write(
      `[login] Logged in as ${identity}${orgName ? ` (org: ${orgName})` : ''}\n`,
    );
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[login] ${msg}\n`);
    return 1;
  } finally {
    if (server) {
      server.close();
    }
  }
}

export const loginCommand: CommandModule = {
  command: 'login',
  describe: 'Log in to the amodal platform',
  builder: (yargs) =>
    yargs
      .option('platform-url', {
        type: 'string',
        describe: 'Platform API URL (default: $PLATFORM_API_URL or https://api.amodalai.com)',
      })
      .option('admin-url', {
        type: 'string',
        describe: 'Admin UI URL (default: $ADMIN_UI_URL or https://app.amodalai.com)',
      }),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const platformUrl = argv['platformUrl'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const adminUrl = argv['adminUrl'] as string | undefined;
    const code = await runLogin({platformUrl, adminUrl});
    process.exit(code);
  },
};
