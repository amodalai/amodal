/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from '@amodalai/runtime';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {runConnectionPreflight, printPreflightTable} from '../shared/connection-preflight.js';

export interface DevOptions {
  cwd?: string;
  port?: number;
  host?: string;
  resume?: string;
}

const DEFAULT_PORT = 3847;

/**
 * Starts a local development server for the repo with hot reload enabled.
 */
export async function runDev(options: DevOptions = {}): Promise<void> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dev] ${msg}\n`);
    process.exit(1);
  }

  // Load .env file from the repo root (if present)
  const envPath = path.join(repoPath, '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }

  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '0.0.0.0';

  process.stderr.write(`[dev] Starting dev server for ${repoPath}\n`);

  try {
    let staticAppDir: string | undefined;

    // Use pre-built static assets for the SPA.
    // Vite dev middleware is only used inside the monorepo with `pnpm dev`.
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      // esbuild bundle: bundle/app/
      path.resolve(scriptDir, 'app'),
    ];

    // Resolve @amodalai/runtime-app via Node module resolution (works regardless of install layout)
    const require = createRequire(import.meta.url);
    const runtimeAppPkg = require.resolve('@amodalai/runtime-app/package.json');
    candidates.push(path.join(path.dirname(runtimeAppPkg), 'dist'));

    for (const dir of candidates) {
      if (existsSync(path.join(dir, 'index.html'))) {
        process.stderr.write('[dev] Serving pre-built runtime app\n');
        staticAppDir = dir;
        break;
      }
    }

    const server = await createLocalServer({
      repoPath,
      port,
      host,
      hotReload: true,
      corsOrigin: '*',
      staticAppDir,
      resumeSessionId: options.resume,
    });

    await server.start();

    // Preflight connection check (non-blocking)
    const preflight = await runConnectionPreflight(repoPath);
    if (preflight.results.length > 0) {
      process.stderr.write('\n');
      printPreflightTable(preflight.results);
      if (preflight.hasFailures) {
        process.stderr.write('\n  WARNING: Some connections failed. The agent may not work correctly.\n');
      }
      process.stderr.write('\n');
    }

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      process.stderr.write(`\n[dev] Received ${signal}, shutting down...\n`);
      await server.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dev] Failed to start: ${msg}\n`);
    process.exit(1);
  }
}

export const devCommand: CommandModule = {
  command: 'dev',
  describe: 'Start local dev server',
  builder: {
    port: {
      type: 'number',
      describe: 'Port to listen on',
    },
    host: {
      type: 'string',
      describe: 'Host to bind to',
    },
    resume: {
      type: 'string',
      describe: 'Resume a previous session by ID or "latest"',
    },
  },
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const port = argv['port'] as number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const host = argv['host'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const resume = argv['resume'] as string | undefined;
    await runDev({port, host, resume});
  },
};
