/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {createLocalServer} from '@amodalai/runtime';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface TestQueryOptions {
  cwd?: string;
  message: string;
  appId?: string;
  port?: number;
}

/**
 * Sends a single test query to an ephemeral repo server and streams
 * the response to stdout.
 */
export async function runTestQuery(options: TestQueryOptions): Promise<void> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[test-query] ${msg}\n`);
    process.exit(1);
  }

  const port = options.port ?? 0; // 0 = random available port
  const appId = options.appId ?? 'test-user';

  process.stderr.write(`[test-query] Loading repo from ${repoPath}\n`);

  const server = await createLocalServer({
    repoPath,
    port,
    host: '127.0.0.1',
    hotReload: false,
  });

  const httpServer = await server.start();
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;

  try {
    const url = `http://127.0.0.1:${actualPort}/chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        message: options.message,
        app_id: appId,
      }),
    });

    if (!response.ok) {
      process.stderr.write(`[test-query] HTTP ${response.status}: ${await response.text()}\n`);
      return;
    }

    // Parse SSE response
    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.substring(6);
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing SSE event
        const event = JSON.parse(jsonStr) as Record<string, unknown>;
        if (event['type'] === 'text_delta') {
          process.stdout.write(String(event['content'] ?? ''));
        } else if (event['type'] === 'tool_call_start') {
          process.stderr.write(`\n[tool] ${event['tool_name']}(${JSON.stringify(event['parameters'])})\n`);
        } else if (event['type'] === 'tool_call_result') {
          const status = event['status'];
          if (status === 'error') {
            process.stderr.write(`[tool] ERROR: ${event['error']}\n`);
          } else {
            const result = String(event['result'] ?? '');
            const preview = result.length > 200 ? result.substring(0, 200) + '...' : result;
            process.stderr.write(`[tool] OK (${event['duration_ms']}ms): ${preview}\n`);
          }
        } else if (event['type'] === 'error') {
          process.stderr.write(`\n[error] ${event['message']}\n`);
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    process.stdout.write('\n');
  } finally {
    await server.stop();
  }
}

export const testQueryCommand: CommandModule = {
  command: 'test-query <message>',
  describe: 'Send a test query to the local server',
  builder: (yargs) =>
    yargs
      .positional('message', {
        type: 'string',
        demandOption: true,
        describe: 'The message to send',
      })
      .option('app-id', {
        type: 'string',
        describe: 'App ID to use for the query',
      })
      .option('port', {
        type: 'number',
        describe: 'Port for the ephemeral server',
      }),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const message = argv['message'] as string;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const appId = argv['app-id'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const port = argv['port'] as number | undefined;

    await runTestQuery({message, appId, port});
  },
};
