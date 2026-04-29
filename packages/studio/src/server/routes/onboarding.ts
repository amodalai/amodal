/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { execSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  cpSync,
  statSync,
} from 'node:fs';
import * as path from 'node:path';
import { logger } from '../../lib/logger.js';

const REPO_PATH_ENV_KEY = 'REPO_PATH';

export const onboardingRoutes = new Hono();

/**
 * POST /api/studio/onboarding/clone — Clone a template repo into the
 * user's project, merge amodal.json, run npm install, and discover
 * credential requirements from installed packages.
 *
 * This is the deterministic core of the onboarding wizard. No LLM
 * involved — just git clone, file operations, and npm.
 */
onboardingRoutes.post('/api/studio/onboarding/clone', async (c) => {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({error: 'REPO_PATH not configured'}, 503);
  }

  const body = await c.req.json();
  const repo = typeof body['repo'] === 'string' ? body['repo'] : '';
  const branch = typeof body['branch'] === 'string' ? body['branch'] : 'main';

  if (!repo || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    return c.json({error: 'Invalid repo format. Expected owner/repo.'}, 400);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(branch)) {
    return c.json({error: 'Invalid branch format.'}, 400);
  }

  const tmpDir = path.join(repoPath, '.amodal', '.tmp-clone');

  try {
    if (existsSync(tmpDir)) rmSync(tmpDir, {recursive: true, force: true});
    mkdirSync(tmpDir, {recursive: true});

    // Shallow clone
    execSync(
      `git clone --depth 1 --branch ${branch} -- https://github.com/${repo}.git ${tmpDir}`,
      {timeout: 60_000},
    );
    rmSync(path.join(tmpDir, '.git'), {recursive: true, force: true});

    // Copy contents, skip card/ and .git. For directories, merge
    // (don't skip empty dirs from amodal init). For files, skip if
    // they already exist (preserves user's .env, .gitignore).
    for (const entry of readdirSync(tmpDir)) {
      if (entry === 'card' || entry === '.git') continue;
      const src = path.join(tmpDir, entry);
      const dst = path.join(repoPath, entry);
      const srcStat = statSync(src);
      if (srcStat.isDirectory()) {
        cpSync(src, dst, {recursive: true, force: false});
      } else if (!existsSync(dst)) {
        cpSync(src, dst);
      }
    }

    // Merge amodal.json: template's packages + settings, user's model config
    const templateConfigPath = path.join(tmpDir, 'amodal.json');
    const userConfigPath = path.join(repoPath, 'amodal.json');
    if (existsSync(templateConfigPath)) {
      let userConfig: Record<string, unknown> = {};
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
        userConfig = JSON.parse(readFileSync(userConfigPath, 'utf-8')) as Record<string, unknown>;
      } catch { /* fresh init */ }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
      const templateConfig = JSON.parse(readFileSync(templateConfigPath, 'utf-8')) as Record<string, unknown>;
      const merged = {
        ...templateConfig,
        name: userConfig['name'] ?? templateConfig['name'],
        version: userConfig['version'] ?? templateConfig['version'],
        ...(userConfig['models'] ? {models: userConfig['models']} : {}),
      };
      writeFileSync(userConfigPath, JSON.stringify(merged, null, 2) + '\n');
    }

    rmSync(tmpDir, {recursive: true, force: true});

    // Read packages from merged amodal.json and install them
    let pkgList: string[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
      const mergedCfg = JSON.parse(readFileSync(userConfigPath, 'utf-8')) as Record<string, unknown>;
      if (Array.isArray(mergedCfg['packages'])) {
        pkgList = mergedCfg['packages'].filter((p): p is string => typeof p === 'string');
      }
    } catch { /* */ }

    if (pkgList.length > 0) {
      execSync(`npm install --no-audit --no-fund ${pkgList.join(' ')}`, {cwd: repoPath, timeout: 120_000});
    }
    logger.info('onboarding_clone_complete', {repo, repoPath, packages: pkgList.length});

    // Discover credentials from installed packages
    const credentials: Array<{name: string; envVar: string; description: string; status: string}> = [];
    let packages: string[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
      const cfg = JSON.parse(readFileSync(userConfigPath, 'utf-8')) as Record<string, unknown>;
      if (Array.isArray(cfg['packages'])) {
        packages = cfg['packages'].filter((p): p is string => typeof p === 'string');
      }
    } catch { /* */ }

    for (const pkg of packages) {
      try {
        const pkgJsonPath = path.join(repoPath, 'node_modules', pkg, 'package.json');
        if (!existsSync(pkgJsonPath)) continue;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing package.json
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- amodal metadata block
        const amodal = pkgJson['amodal'] as Record<string, unknown> | undefined;
        if (!amodal?.['auth']) continue;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth block
        const auth = amodal['auth'] as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- envVars record
        const envVars = (auth['envVars'] ?? {}) as Record<string, string>;
        const displayName = typeof amodal['displayName'] === 'string' ? amodal['displayName']
          : typeof amodal['name'] === 'string' ? amodal['name']
          : pkg.split('/').pop() ?? pkg;
        for (const [envVar, description] of Object.entries(envVars)) {
          credentials.push({
            name: displayName,
            envVar,
            description,
            status: process.env[envVar] ? 'connected' : 'pending',
          });
        }
      } catch {
        logger.debug('onboarding_pkg_read_error', {pkg});
      }
    }

    return c.json({ok: true, repo, credentials});
  } catch (err: unknown) {
    if (existsSync(tmpDir)) rmSync(tmpDir, {recursive: true, force: true});
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('onboarding_clone_failed', {repo, error: message});
    return c.json({error: message}, 500);
  }
});

/**
 * POST /api/studio/onboarding/save-secret — Save a secret to the
 * runtime's secrets file and set it in process.env.
 */
onboardingRoutes.post('/api/studio/onboarding/save-secret', async (c) => {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({error: 'REPO_PATH not configured'}, 503);
  }

  const body = await c.req.json();
  const name = typeof body['name'] === 'string' ? body['name'] : '';
  const value = typeof body['value'] === 'string' ? body['value'].trim() : '';

  if (!name || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return c.json({error: 'Secret name must be uppercase with underscores'}, 400);
  }
  if (!value) {
    return c.json({error: 'Value is required'}, 400);
  }

  const dir = path.join(repoPath, '.amodal');
  const file = path.join(dir, 'secrets.env');
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});

  let content = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const lines = content.split('\n').filter((l) => !l.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  content = lines.filter((l) => l.length > 0).join('\n') + '\n';
  writeFileSync(file, content, {mode: 0o600});

  process.env[name] = value;
  logger.info('onboarding_secret_saved', {name});

  return c.json({ok: true, name});
});
