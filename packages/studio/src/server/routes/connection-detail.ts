/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/studio/connection/:packageName — connection metadata
 * (auth type, env-vars, OAuth shape, displayName) read directly from
 * `node_modules/<packageName>/package.json#amodal`.
 *
 * Equivalent to the runtime's `/api/connections/:packageName`, but
 * Studio-side. Used during setup when the runtime hasn't booted yet
 * (no `amodal.json` on disk → CLI skips runtime → modal can't reach
 * the runtime endpoint). Same response shape as the runtime endpoint
 * so `<ConnectionConfigForm>` works against either.
 *
 * Reads `package.json` directly without loading the full agent
 * bundle — keeps this endpoint cheap and runtime-free.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { Hono } from 'hono';

import { logger } from '../../lib/logger.js';

const REPO_PATH_ENV_KEY = 'REPO_PATH';

interface PackageJsonAmodal {
  displayName?: string;
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  auth?: {
    type?: string;
    envVars?: Record<string, string>;
  };
  oauth?: {
    appKey: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
  };
}

interface PackageJson {
  name?: string;
  amodal?: PackageJsonAmodal;
}

export const connectionDetailRoutes = new Hono();

connectionDetailRoutes.get('/api/studio/connection/:packageName', async (c) => {
  const packageName = decodeURIComponent(c.req.param('packageName'));
  if (!packageName) {
    return c.json({ error: { code: 'BAD_PACKAGE', message: 'Package name is required' } }, 400);
  }

  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json(
      { error: { code: 'NO_REPO_PATH', message: 'REPO_PATH is not set' } },
      503,
    );
  }

  // Resolve scoped packages: `@amodalai/connection-slack` ->
  // `node_modules/@amodalai/connection-slack/`.
  const pkgDir = path.join(repoPath, 'node_modules', ...packageName.split('/'));
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return c.json(
      {
        error: {
          code: 'NOT_INSTALLED',
          message:
            `Package '${packageName}' is not installed in this repo's node_modules. ` +
            `If you arrived here via a connection panel during setup, the agent likely emitted a ` +
            `package name that doesn't match what install_template put on disk. Check ` +
            `setup_state.plan.slots[*].options[*].packageName for the canonical names.`,
        },
      },
      404,
    );
  }

  let raw: string;
  try {
    raw = await readFile(pkgJsonPath, 'utf-8');
  } catch (err: unknown) {
    logger.warn('connection_detail_read_failed', {
      packageName,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: { code: 'READ_FAILED', message: 'Could not read package.json' } }, 500);
  }

  let pkg: PackageJson;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing local package.json
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return c.json(
      { error: { code: 'MALFORMED', message: `Malformed package.json for '${packageName}'` } },
      500,
    );
  }

  if (!pkg.amodal) {
    return c.json(
      { error: { code: 'NOT_AMODAL_PACKAGE', message: `'${packageName}' has no #amodal block in package.json` } },
      404,
    );
  }

  const auth = pkg.amodal.auth ?? {};
  const envVarsRaw = auth.envVars ?? {};
  const envVars = Object.entries(envVarsRaw).map(([name, description]) => ({
    name,
    description,
    set: typeof process.env[name] === 'string' && process.env[name].length > 0,
  }));

  let oauth: {
    appKey: string;
    available: boolean;
    scopes?: string[];
    reason?: 'no_credentials';
  } | null = null;
  if (pkg.amodal.oauth?.appKey) {
    const appKey = pkg.amodal.oauth.appKey;
    const upper = appKey.toUpperCase().replace(/-/g, '_');
    const haveCreds =
      typeof process.env[`${upper}_CLIENT_ID`] === 'string' &&
      typeof process.env[`${upper}_CLIENT_SECRET`] === 'string';
    oauth = haveCreds
      ? { appKey, available: true, scopes: pkg.amodal.oauth.scopes }
      : {
          appKey,
          available: false,
          scopes: pkg.amodal.oauth.scopes,
          reason: 'no_credentials',
        };
  }

  return c.json({
    name: pkg.name ?? packageName,
    displayName: pkg.amodal.displayName ?? pkg.amodal.name ?? pkg.name ?? packageName,
    description: pkg.amodal.description ?? null,
    icon: pkg.amodal.icon ?? null,
    category: pkg.amodal.category ?? null,
    authType: auth.type ?? 'unknown',
    envVars,
    oauth,
  });
});
