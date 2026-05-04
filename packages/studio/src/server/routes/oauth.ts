/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/oauth/start  — kick off an OAuth flow for a connection package
 * GET /api/oauth/callback — finish the dance, exchange code → tokens, persist
 *
 * Lives on Studio (not the runtime) so the bootstrap flow works even when
 * `amodal.json` doesn't exist yet — the user picks a template, walks the
 * setup chat, and Configures connections before any agent is composed.
 * Studio is the boot surface; the runtime is a downstream consumer.
 *
 * Reads `node_modules/<packageName>/package.json#amodal.oauth` directly
 * to get authorize / token URLs, scopes, and the env-var mapping.
 *
 * Persists tokens to `<repoPath>/.amodal/secrets.env`. The runtime
 * watches that file (see runtime/src/agent/local-server.ts) and reloads
 * `process.env` on change, so credentials reach the running runtime
 * without a restart. In cloud, the same flow points at the credentials
 * table instead — same protocol, different home.
 *
 * `${UPPER}_CLIENT_ID` / `${UPPER}_CLIENT_SECRET` come from `process.env`
 * — set them in `.env` for local-broker mode, or use the cloud broker.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import { Hono } from 'hono';

import { logger } from '../../lib/logger.js';

const REPO_PATH_ENV_KEY = 'REPO_PATH';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface PendingOauth {
  packageName: string;
  appKey: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  envVars: Record<string, string>;
  createdAt: number;
}

const pendingOauth = new Map<string, PendingOauth>();

function reapExpiredOauthStates(): void {
  const now = Date.now();
  for (const [k, v] of pendingOauth) {
    if (now - v.createdAt > OAUTH_STATE_TTL_MS) pendingOauth.delete(k);
  }
}

interface PackageOauthMeta {
  oauth: {
    appKey: string;
    authorizeUrl: string;
    tokenUrl: string;
    scopes?: string[];
    scopeSeparator?: string;
  };
  envVars: Record<string, string>;
}

/**
 * Read `amodal.oauth` for a package by going straight to the
 * package.json on disk. No bundle resolution — Studio runs before the
 * agent bundle exists, so we walk node_modules directly.
 */
async function readPackageOauth(repoPath: string, packageName: string): Promise<PackageOauthMeta | null> {
  const pkgJsonPath = path.join(repoPath, 'node_modules', ...packageName.split('/'), 'package.json');
  if (!existsSync(pkgJsonPath)) return null;
  let raw: string;
  try {
    raw = await readFile(pkgJsonPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
   
  const pkg = parsed as {
    name?: string;
    amodal?: {
      oauth?: { appKey: string; authorizeUrl: string; tokenUrl: string; scopes?: string[]; scopeSeparator?: string };
      auth?: { envVars?: Record<string, string> };
    };
  };
  if (pkg.name !== packageName || !pkg.amodal?.oauth) return null;
  return {
    oauth: pkg.amodal.oauth,
    envVars: pkg.amodal.auth?.envVars ?? {},
  };
}

/**
 * Append/replace KEY=value in `<repoPath>/.amodal/secrets.env`. Kept
 * separate from the user's `.env` so runtime-issued tokens (OAuth,
 * paste-saves) never risk stomping hand-edited DATABASE_URL /
 * ANTHROPIC_API_KEY / feature flags. The runtime watches this file
 * and reloads `process.env` on change.
 *
 * Mode 0600 — owner-only — since this file holds raw access tokens.
 */
function persistSecret(repoPath: string, name: string, value: string): void {
  const dir = path.join(repoPath, '.amodal');
  const file = path.join(dir, 'secrets.env');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const lines = existing.split('\n').filter((l) => !l.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  const content = lines.filter((l) => l.length > 0).join('\n') + '\n';
  writeFileSync(file, content, { mode: 0o600 });
  logger.info('secret_persisted', { name, file });
}

/**
 * Map the token-exchange response onto the package's declared envVars.
 * Heuristic: `*REFRESH*` → refresh_token, anything else → access_token.
 */
function mapTokensToEnvVars(
  tokens: Record<string, unknown>,
  envVars: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(envVars)) {
    const lower = name.toLowerCase();
    if (lower.includes('refresh') && typeof tokens['refresh_token'] === 'string') {
      out[name] = tokens['refresh_token'];
    } else if (typeof tokens['access_token'] === 'string') {
      out[name] = tokens['access_token'];
    }
  }
  return out;
}

export const oauthRoutes = new Hono();

/**
 * POST /api/secrets/:name — write a paste-field credential into `.env`.
 *
 * Used by `<ConnectionConfigForm>` when the user pastes an API key /
 * bot token / etc. directly. Lives on Studio (not the runtime) for
 * the same reason `/api/oauth/*` does — Studio is the boot surface,
 * up before the runtime has an `amodal.json` to load. The runtime
 * watches `.env` and reloads `process.env` on change.
 */
oauthRoutes.post('/api/secrets/:name', async (c) => {
  const name = c.req.param('name');
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return c.json({ error: 'Secret name must be uppercase with underscores (e.g. SLACK_BOT_TOKEN)' }, 400);
  }
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({ error: 'REPO_PATH is not set' }, 500);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return c.json({ error: 'Body must be an object with a "value" field' }, 400);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
  const value = typeof (body as Record<string, unknown>)['value'] === 'string'
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
    ? ((body as Record<string, unknown>)['value'] as string).trim()
    : '';
  if (!value) {
    return c.json({ error: 'value is required' }, 400);
  }
  process.env[name] = value;
  persistSecret(repoPath, name, value);
  return c.json({ ok: true });
});

oauthRoutes.get('/api/oauth/start', async (c) => {
  reapExpiredOauthStates();

  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({ error: 'REPO_PATH is not set in the Studio process env' }, 500);
  }

  const packageName = c.req.query('package') ?? '';
  if (!packageName) {
    return c.json({ error: 'package query param required' }, 400);
  }

  const meta = await readPackageOauth(repoPath, packageName);
  if (!meta) {
    return c.json({ error: `${packageName} has no amodal.oauth metadata` }, 404);
  }

  const upper = meta.oauth.appKey.toUpperCase().replace(/-/g, '_');
  const clientId = process.env[`${upper}_CLIENT_ID`];
  const clientSecret = process.env[`${upper}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    logger.warn('oauth_missing_credentials', { packageName, appKey: upper });
    return c.json(
      {
        error:
          `Missing ${upper}_CLIENT_ID or ${upper}_CLIENT_SECRET in env. Register your own OAuth app and set them in .env, or use the cloud broker.`,
      },
      400,
    );
  }

  // The redirect_uri must match the host the browser is talking to so
  // the provider posts back to this Studio process. Honor x-forwarded-*
  // for proxies; fall back to the inbound Host header.
  const protoHeader = c.req.header('x-forwarded-proto');
  const proto = protoHeader && protoHeader.length > 0 ? protoHeader : 'http';
  const host = c.req.header('host') ?? `localhost:${process.env['STUDIO_PORT'] ?? '3848'}`;
  const redirectUri = `${proto}://${host}/api/oauth/callback`;

  const state = randomUUID();
  pendingOauth.set(state, {
    packageName,
    appKey: meta.oauth.appKey,
    tokenUrl: meta.oauth.tokenUrl,
    clientId,
    clientSecret,
    redirectUri,
    envVars: meta.envVars,
    createdAt: Date.now(),
  });

  const url = new URL(meta.oauth.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  if (meta.oauth.scopes && meta.oauth.scopes.length > 0) {
    const sep = meta.oauth.scopeSeparator ?? ' ';
    url.searchParams.set('scope', meta.oauth.scopes.join(sep));
  }

  logger.info('oauth_flow_started', { packageName, appKey: meta.oauth.appKey });
  return c.json({ authorizeUrl: url.toString() });
});

/**
 * Render the small page returned to the OAuth popup when the dance
 * completes. Two responsibilities:
 *
 * 1. `postMessage` the result back to the opener (`window.opener`)
 *    so a listening parent can react instantly without polling.
 * 2. `window.close()` so the parent's `popup.closed` polling fires
 *    and the modal can refetch + dismiss.
 *
 * If the popup was opened from a same-tab redirect (no opener), we
 * fall back to navigating to '/' with a query param so the user
 * still ends up somewhere sensible.
 */
function renderPopupClosePage(payload: Record<string, string>): string {
  const json = JSON.stringify({ type: 'amodal:oauth:done', ...payload });
  const fallbackQuery = new URLSearchParams(payload).toString();
  // The script is a single self-invoking function. Defensive try/catch
  // because cross-origin opener references can throw in some browsers.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connected</title>
  <style>
    body { font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           color: #475569; background: #f8fafc; margin: 0;
           display: flex; align-items: center; justify-content: center; height: 100vh; }
    p { text-align: center; }
  </style>
</head>
<body>
  <p>You can close this window.</p>
  <script>
    (function () {
      var payload = ${json};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, '*');
        }
      } catch (e) { /* opener cross-origin, ignore */ }
      try {
        window.close();
      } catch (e) { /* close blocked, ignore */ }
      // Fallback if window.close was blocked or there's no opener.
      setTimeout(function () {
        if (!window.opener || window.opener.closed) {
          window.location.replace('/?${fallbackQuery}');
        }
      }, 250);
    })();
  </script>
</body>
</html>`;
}

oauthRoutes.get('/api/oauth/callback', async (c) => {
  reapExpiredOauthStates();

  const repoPath = process.env[REPO_PATH_ENV_KEY];
  const code = c.req.query('code') ?? '';
  const state = c.req.query('state') ?? '';
  const errParam = c.req.query('error') ?? '';

  // Unconditional log at handler entry so we can confirm the provider
  // actually redirected here. If you see this fire after approving,
  // the callback wiring is good and any failure is downstream (token
  // exchange, persistSecret, etc.). If you don't see it, the provider
  // redirected somewhere else — usually a stale Redirect URL on the
  // OAuth app pointing at the old runtime port.
  logger.info('oauth_callback_hit', {
    hasCode: !!code,
    hasState: !!state,
    hasError: !!errParam,
    host: c.req.header('host') ?? '',
  });

  if (errParam) {
    logger.warn('oauth_provider_error', { error: errParam });
    return c.html(renderPopupClosePage({ error: 'oauth_failed', message: errParam }));
  }

  const pending = pendingOauth.get(state);
  if (!pending || !code) {
    logger.warn('oauth_invalid_callback', { hasState: !!pending, hasCode: !!code });
    return c.html(renderPopupClosePage({ error: 'oauth_failed', message: 'unknown state or missing code' }));
  }
  pendingOauth.delete(state);

  if (!repoPath) {
    return c.html(renderPopupClosePage({ error: 'oauth_failed', message: 'REPO_PATH is not set' }));
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      client_secret: pending.clientSecret,
    });
    const tokenResp = await fetch(pending.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text().catch(() => '');
      throw new Error(`token exchange failed: HTTP ${String(tokenResp.status)} ${text}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
    const tokens = (await tokenResp.json()) as Record<string, unknown>;

    // Provider-level failure check. Some providers (notably Slack)
    // always return HTTP 200 and encode failures in the body as
    // `{ok: false, error: "..."}`. Treat that as the real failure
    // signal — without this, we'd silently parse no access_token and
    // persist zero credentials, leaving the user with a "connected"
    // panel but no working connection.
    if (tokens['ok'] === false) {
      const errorCode = typeof tokens['error'] === 'string' ? tokens['error'] : 'unknown';
      throw new Error(`provider rejected token exchange: ${errorCode}`);
    }

    const credentials = mapTokensToEnvVars(tokens, pending.envVars);
    if (Object.keys(credentials).length === 0) {
      // Provider returned 200 + ok:true but no recognizable token
      // field — usually a mapping bug (envVar names don't match the
      // heuristic in mapTokensToEnvVars) or a non-standard response
      // shape. Surface the keys so we can extend the mapping.
      throw new Error(
        `token exchange returned no recognized credentials. Response keys: [${Object.keys(tokens).join(', ')}]. Declared envVars: [${Object.keys(pending.envVars).join(', ')}]`,
      );
    }
    for (const [name, value] of Object.entries(credentials)) {
      process.env[name] = value;
      persistSecret(repoPath, name, value);
    }
    logger.info('oauth_token_exchanged', {
      packageName: pending.packageName,
      envVarsSet: Object.keys(credentials),
    });
    return c.html(renderPopupClosePage({ connected: pending.packageName }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('oauth_token_exchange_failed', { packageName: pending.packageName, error: msg });
    return c.html(renderPopupClosePage({ error: 'oauth_failed', message: msg }));
  }
});
