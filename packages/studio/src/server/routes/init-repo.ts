/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { logger } from '../../lib/logger.js';

const REPO_PATH_ENV_KEY = 'REPO_PATH';
const AMODAL_JSON = 'amodal.json';

/**
 * Inlined from `@amodalai/core`'s package-manager.ts to avoid making core
 * a Studio runtime dep just for one helper.
 */
function ensurePackageJson(repoPath: string, projectName: string): void {
  const pkgPath = path.join(repoPath, 'package.json');
  if (existsSync(pkgPath)) return;
  const pkg = { name: projectName, private: true, type: 'module' };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * POST /api/init-repo — scaffold a default `amodal.json` + folder layout
 * in the configured repo. Mirrors `amodal init`'s output so a user who
 * hits "Skip onboarding" lands in the same shape as someone who ran the
 * CLI. Idempotent: returns `{ created: false }` when `amodal.json`
 * already exists.
 */
export const initRepoRoutes = new Hono();

initRepoRoutes.post('/api/init-repo', async (c) => {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({ error: 'repo_path_not_configured' }, 503);
  }

  const configPath = path.join(repoPath, AMODAL_JSON);
  if (existsSync(configPath)) {
    return c.json({ created: false, repoPath });
  }

  const name = path.basename(repoPath) || 'my-agent';

  try {
    // Folder layout — matches `amodal init`.
    for (const dir of ['connections', 'skills', 'knowledge', 'automations', 'evals']) {
      mkdirSync(path.join(repoPath, dir), { recursive: true });
    }

    // Default config — Anthropic Sonnet, no packages installed.
    const config = {
      name,
      version: '1.0.0',
      models: {
        main: {
          provider: 'anthropic' as const,
          model: 'claude-sonnet-4-20250514',
        },
      },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

    ensurePackageJson(repoPath, name);

    const gitignorePath = path.join(repoPath, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '.amodal/\nnode_modules/\n.env\n.env.*\n');
    }

    const envPath = path.join(repoPath, '.env');
    if (!existsSync(envPath)) {
      writeFileSync(
        envPath,
        '# Amodal environment variables\n# Add your provider API key (e.g. ANTHROPIC_API_KEY)\n# DATABASE_URL=postgresql://localhost:5432/amodal\nANTHROPIC_API_KEY=\n',
      );
    }

    logger.info('repo_initialized', { repoPath, name });
    return c.json({ created: true, repoPath, name });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('repo_init_failed', { repoPath, error: message });
    return c.json({ error: 'init_failed', message }, 500);
  }
});
