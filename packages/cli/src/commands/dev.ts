/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from '@amodalai/runtime';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {runConnectionPreflight, printPreflightTable} from '../shared/connection-preflight.js';

async function loadRuntimeApp(): Promise<typeof import('@amodalai/runtime-app/dev') | null> {
  try {
    return await import('@amodalai/runtime-app/dev');
  } catch {
    // Runtime app is optional — server-only mode without the frontend
    return null;
  }
}

export interface DevOptions {
  cwd?: string;
  port?: number;
  host?: string;
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

  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '0.0.0.0';

  process.stderr.write(`[dev] Starting dev server for ${repoPath}\n`);

  try {
    // Try to load the runtime app for the dev UI
    let appMiddleware: ((req: unknown, res: unknown, next: unknown) => void) | undefined;
    let staticAppDir: string | undefined;

    const runtimeApp = await loadRuntimeApp();
    if (runtimeApp) {
      process.stderr.write('[dev] Loading runtime app (Vite dev server)...\n');
      appMiddleware = await runtimeApp.createDevMiddleware(repoPath);
    } else {
      // Fall back to pre-built static assets (bundled mode or global install)
      const scriptDir = path.dirname(fileURLToPath(import.meta.url));
      const candidates = [
        // esbuild bundle: bundle/app/
        path.resolve(scriptDir, 'app'),
        // global/local install: <pkg root>/node_modules/@amodalai/runtime-app/dist/
        path.resolve(scriptDir, '..', '..', '..', 'node_modules', '@amodalai', 'runtime-app', 'dist'),
      ];
      for (const dir of candidates) {
        if (existsSync(path.join(dir, 'index.html'))) {
          process.stderr.write('[dev] Serving pre-built runtime app\n');
          staticAppDir = dir;
          break;
        }
      }
    }

    const server = await createLocalServer({
      repoPath,
      port,
      host,
      hotReload: true,
      corsOrigin: '*',
      appMiddleware,
      staticAppDir,
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
  },
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const port = argv['port'] as number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const host = argv['host'] as string | undefined;
    await runDev({port, host});
  },
};
