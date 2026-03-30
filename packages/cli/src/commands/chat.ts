/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type http from 'node:http';
import {createElement} from 'react';
import {render} from 'ink';
import type {CommandModule} from 'yargs';
import {createLocalServer, createSnapshotServer} from '@amodalai/runtime';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {runConnectionPreflight, printPreflightTable} from '../shared/connection-preflight.js';
import {ChatApp} from '../ui/ChatApp.js';

export interface ChatOptions {
  cwd?: string;
  url?: string;
  config?: string;
  tenantId?: string;
  port?: number;
  resume?: string;
  fullscreen?: boolean;
}

/**
 * Interactive chat session against a local repo, snapshot, or remote server.
 *
 * Three modes:
 *   --url <remote>    → connect to an already-running server (no local boot)
 *   --config <file>   → boot from a snapshot file
 *   (default)         → boot from the local repo
 */
export async function runChat(options: ChatOptions): Promise<void> {
  const tenantId = options.tenantId ?? 'cli-user';

  // Mode 1: Connect to a remote server
  if (options.url) {
    const baseUrl = options.url.replace(/\/$/, '');
    process.stderr.write(`[chat] Connecting to ${baseUrl}\n`);

    const {waitUntilExit} = render(
      createElement(ChatApp, {
        baseUrl,
        tenantId,
        resumeSessionId: options.resume,
        fullscreen: options.fullscreen,
      }),
    );
    await waitUntilExit();
    return;
  }

  // Mode 2 & 3: Boot a local server
  const port = options.port ?? 0;
  let serverInstance: {app: unknown; start: () => Promise<unknown>; stop: () => Promise<void>};
  let repoPath: string | undefined;

  if (options.config) {
    process.stderr.write(`[chat] Loading snapshot from ${options.config}\n`);
    serverInstance = await createSnapshotServer({
      snapshotPath: options.config,
      port,
      host: '127.0.0.1',
    });
  } else {
    try {
      repoPath = findRepoRoot(options.cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[chat] ${msg}\n`);
      process.exit(1);
    }

    process.stderr.write(`[chat] Loading repo from ${repoPath}\n`);
    serverInstance = await createLocalServer({
      repoPath,
      port,
      host: '127.0.0.1',
      hotReload: false,
    });
  }

  const httpServer = await serverInstance.start();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const addr = (httpServer as http.Server).address();
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;

  // Preflight connection check (non-blocking)
  if (repoPath) {
    const preflight = await runConnectionPreflight(repoPath);
    if (preflight.results.length > 0) {
      process.stderr.write('\n');
      printPreflightTable(preflight.results);
      if (preflight.hasFailures) {
        process.stderr.write('\n  WARNING: Some connections failed. The agent may not work correctly.\n');
      }
      process.stderr.write('\n');
    }
  }

  const {waitUntilExit} = render(
    createElement(ChatApp, {
      baseUrl,
      tenantId,
      resumeSessionId: options.resume,
      fullscreen: options.fullscreen,
    }),
  );
  await waitUntilExit();
  await serverInstance.stop();
}

export const chatCommand: CommandModule = {
  command: 'chat',
  describe: 'Interactive chat with the agent',
  builder: (yargs) =>
    yargs
      .option('url', {
        type: 'string',
        describe: 'Connect to a remote server URL',
      })
      .option('config', {
        type: 'string',
        describe: 'Path to resolved-config.json snapshot',
      })
      .option('tenant-id', {
        type: 'string',
        describe: 'Tenant ID for the session',
      })
      .option('port', {
        type: 'number',
        describe: 'Port for the local server',
      })
      .option('resume', {
        type: 'string',
        describe: 'Resume a previous session by ID or "latest"',
      })
      .option('fullscreen', {
        type: 'boolean',
        describe: 'Use alternate buffer for full-screen mode',
        default: false,
      }),
  handler: async (argv) => {
    await runChat({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      url: argv['url'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      config: argv['config'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      tenantId: argv['tenantId'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      port: argv['port'] as number | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      resume: argv['resume'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      fullscreen: argv['fullscreen'] as boolean | undefined,
    });
  },
};
