/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/connections-status — Phase H.9 of the admin-setup build
 * plan, but implemented now because Phase E.5's commit-setup endpoint
 * needs it to validate readiness against real env-var state.
 *
 * Returns `{[packageName]: {configured, envVarsSet}}` by:
 *   1. Reading `amodal.json#packages` for the agent's declared packages.
 *   2. For each, walking
 *      `<repoPath>/node_modules/<packageName>/package.json#amodal.auth.envVars`
 *      to find the required env-var names.
 *   3. Checking each name's value in `process.env` — non-empty = set.
 *   4. `configured: true` iff every required name has a value.
 *
 * Read-only; no secrets in the response (only the names of vars that
 * are set, never their values). Lives on Studio because the validate
 * path runs pre-commit (the user's runtime hasn't booted yet).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { Hono } from 'hono';

import type { ConnectionsStatusMap } from '@amodalai/types';
import { logger } from '../../lib/logger.js';

const REPO_PATH_ENV_KEY = 'REPO_PATH';
const AMODAL_JSON = 'amodal.json';

export const connectionsStatusRoutes = new Hono();

connectionsStatusRoutes.get('/api/connections-status', async (c) => {
  const map = await computeConnectionsStatus();
  return c.json(map);
});

/**
 * Compute the connections-status map without going through the HTTP
 * layer. Used by `admin-chat.ts`'s check-completion / commit-setup
 * endpoints so they can pass live env-var status to
 * `validateSetupReadiness` + `commitSetup` without an in-process
 * loopback request.
 *
 * Returns an empty map when REPO_PATH isn't set or amodal.json
 * doesn't exist; callers fall through to their state.completed[]
 * fallback.
 */
export async function computeConnectionsStatus(): Promise<ConnectionsStatusMap> {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) return {};

  const amodalJsonPath = path.join(repoPath, AMODAL_JSON);
  const declaredPackages = await readDeclaredPackages(amodalJsonPath);
  const map: ConnectionsStatusMap = {};

  for (const packageName of declaredPackages) {
    const status = await statusForPackage(repoPath, packageName);
    if (status) map[packageName] = status;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readDeclaredPackages(amodalJsonPath: string): Promise<string[]> {
  if (!existsSync(amodalJsonPath)) return [];
  let raw: string;
  try {
    raw = await readFile(amodalJsonPath, 'utf-8');
  } catch (err: unknown) {
    logger.warn('connections_status_read_amodal_json_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON
  const obj = parsed as Record<string, unknown>;
  const packages = obj['packages'];
  if (!Array.isArray(packages)) return [];

  const out: string[] = [];
  for (const entry of packages) {
    if (typeof entry === 'string' && entry.length > 0) {
      out.push(entry);
      continue;
    }
    // Entry-object form: `{package: "@amodalai/connection-slack", use: [...]}`.
    if (typeof entry === 'object' && entry !== null) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON
      const e = entry as Record<string, unknown>;
      const name = e['package'];
      if (typeof name === 'string' && name.length > 0) out.push(name);
    }
  }
  return out;
}

async function statusForPackage(
  repoPath: string,
  packageName: string,
): Promise<ConnectionsStatusMap[string] | null> {
  // Resolve scoped packages: `@amodalai/connection-slack` ->
  // `node_modules/@amodalai/connection-slack/`.
  const pkgDir = path.join(repoPath, 'node_modules', ...packageName.split('/'));
  const pkgJsonPath = path.join(pkgDir, 'package.json');
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON
  const pkg = parsed as Record<string, unknown>;
  const amodal = pkg['amodal'];
  if (typeof amodal !== 'object' || amodal === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON
  const auth = (amodal as Record<string, unknown>)['auth'];
  if (typeof auth !== 'object' || auth === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON
  const envVars = (auth as Record<string, unknown>)['envVars'];
  if (typeof envVars !== 'object' || envVars === null) return null;

  // Skip non-connection packages (e.g. templates) that don't declare
  // envVars — they show up as "no requirements" rather than as
  // misconfigured.
  const requiredNames = Object.keys(envVars).filter(
    (name) => typeof name === 'string' && name.length > 0,
  );
  if (requiredNames.length === 0) {
    return { configured: true, envVarsSet: [] };
  }

  const set: string[] = [];
  for (const name of requiredNames) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) set.push(name);
  }

  return {
    configured: set.length === requiredNames.length,
    envVarsSet: set,
  };
}
