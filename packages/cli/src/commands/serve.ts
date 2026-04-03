/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {loadSnapshotFromFile, snapshotToBundle} from '@amodalai/core';
import type {AgentBundle} from '@amodalai/core';
import {createLocalServer, initLogLevel, interceptConsole} from '@amodalai/runtime';
import {PlatformClient} from '../shared/platform-client.js';

export interface ServeOptions {
  config?: string;
  platform?: boolean;
  project?: string;
  env?: string;
  port?: number;
  host?: string;
  verbose?: number;
  quiet?: boolean;
}

const DEFAULT_PORT = 3847;

/**
 * Load a repo from a snapshot file or from the platform.
 */
async function loadFromSource(options: ServeOptions): Promise<AgentBundle | null> {
  if (options.config) {
    process.stderr.write(`[serve] Loading snapshot from ${options.config}...\n`);
    try {
      const snapshot = await loadSnapshotFromFile(options.config);
      const repo = snapshotToBundle(snapshot, options.config);
      process.stderr.write(`[serve] Loaded ${snapshot.deployId} (${snapshot.skills.length} skills, ${Object.keys(snapshot.connections).length} connections)\n`);
      return repo;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[serve] Failed to load snapshot: ${msg}\n`);
      return null;
    }
  }

  if (options.platform) {
    process.stderr.write('[serve] Fetching active snapshot from platform...\n');
    let client: PlatformClient;
    try {
      client = await PlatformClient.create();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[serve] ${msg}\n`);
      return null;
    }

    const environment = options.env ?? 'production';
    try {
      const snapshot = await client.getActiveSnapshot(environment);
      const repo = snapshotToBundle(snapshot, `platform:${environment}`);
      process.stderr.write(`[serve] Loaded ${snapshot.deployId} from ${environment}\n`);
      return repo;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[serve] Failed to fetch snapshot: ${msg}\n`);
      return null;
    }
  }

  process.stderr.write('[serve] Specify --config <file> or --platform to load a snapshot.\n');
  return null;
}

/**
 * Load an agent runtime from a snapshot (file or platform) and start the server.
 *
 * Returns the loaded repo, or exits with error.
 */
export async function runServe(options: ServeOptions): Promise<AgentBundle | null> {
  initLogLevel({verbosity: options.verbose ?? 0, quiet: options.quiet ?? false});
  interceptConsole();

  const repo = await loadFromSource(options);
  if (!repo) return null;

  // Start the runtime server
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '0.0.0.0';

  process.stderr.write(`[serve] Starting server on ${host}:${port}...\n`);

  try {
    const server = await createLocalServer({
      repoPath: repo.origin,
      port,
      host,
      hotReload: false,
      corsOrigin: '*',
    });

    await server.start();

    process.stderr.write(`[serve] Agent "${repo.config.name}" serving at http://${host}:${port}\n`);

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      process.stderr.write(`\n[serve] Received ${signal}, shutting down...\n`);
      await server.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[serve] Failed to start server: ${msg}\n`);
    return null;
  }

  return repo;
}

export const serveCommand: CommandModule = {
  command: 'serve',
  describe: 'Load and serve an agent from a snapshot',
  builder: (yargs) =>
    yargs
      .option('config', {
        type: 'string',
        describe: 'Path to resolved-config.json snapshot file',
      })
      .option('platform', {
        type: 'boolean',
        describe: 'Fetch active snapshot from platform',
        default: false,
      })
      .option('project', {
        type: 'string',
        describe: 'Platform project name',
      })
      .option('env', {
        type: 'string',
        describe: 'Platform environment (default: production)',
      })
      .option('port', {
        type: 'number',
        describe: `Port to listen on (default: ${DEFAULT_PORT})`,
      })
      .option('host', {
        type: 'string',
        describe: 'Host to bind to (default: 0.0.0.0)',
      })
      .option('verbose', {
        alias: 'v',
        type: 'count',
        describe: 'Increase log verbosity (-v debug, -vv trace)',
        default: 0,
      })
      .option('quiet', {
        alias: 'q',
        type: 'boolean',
        describe: 'Only show errors',
        default: false,
      }),
  handler: async (argv) => {
    const repo = await runServe({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      config: argv['config'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      platform: argv['platform'] as boolean | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      project: argv['project'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      env: argv['env'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      port: argv['port'] as number | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      host: argv['host'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      verbose: argv['verbose'] as number,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      quiet: argv['quiet'] as boolean,
    });
    if (!repo) {
      process.exit(1);
    }
    // Server is running — process stays alive until SIGTERM/SIGINT
  },
};
