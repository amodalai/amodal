/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {resolvePlatformConfig} from '../shared/platform-client.js';

export interface AuditOptions {
  sessionId: string;
  format?: 'json' | 'table';
  platformUrl?: string;
  platformApiKey?: string;
}

/**
 * Retrieve audit trail for a session from the platform.
 */
export async function runAudit(options: AuditOptions): Promise<void> {
  let platformUrl: string;
  let apiKey: string;
  try {
    const config = await resolvePlatformConfig({
      url: options.platformUrl,
      apiKey: options.platformApiKey,
    });
    platformUrl = config.url;
    apiKey = config.apiKey;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[audit] ${msg}\n`);
    process.exit(1);
  }

  try {
    const response = await fetch(`${platformUrl}/api/audit/sessions/${options.sessionId}`, {
      headers: {'Authorization': `Bearer ${apiKey}`},
    });

    if (!response.ok) {
      process.stderr.write(`[audit] HTTP ${response.status}: ${await response.text()}\n`);
      process.exit(1);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
    const data = await response.json() as {
      sessionId: string;
      events: Array<{
        id: string;
        eventType: string;
        data: Record<string, unknown>;
        tokenCount: number | null;
        durationMs: number | null;
        createdAt: string;
      }>;
    };

    if (options.format === 'json') {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }

    // Table format
    const events = data.events;
    if (events.length === 0) {
      process.stdout.write('No audit events found for this session.\n');
      return;
    }

    const typeWidth = Math.max(10, ...events.map((e) => e.eventType.length));
    process.stdout.write(`\nSession: ${data.sessionId}\n`);
    process.stdout.write(`${'Type'.padEnd(typeWidth)}  ${'Time'.padEnd(24)}  Details\n`);
    process.stdout.write('-'.repeat(typeWidth + 50) + '\n');

    for (const event of events) {
      const time = event.createdAt.slice(0, 24);
      const details = event.durationMs ? `${event.durationMs}ms` : '';
      process.stdout.write(`${event.eventType.padEnd(typeWidth)}  ${time.padEnd(24)}  ${details}\n`);
    }

    process.stdout.write(`\nTotal: ${events.length} events\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[audit] Error: ${msg}\n`);
    process.exit(1);
  }
}

export const auditCommand: CommandModule = {
  command: 'audit <session-id>',
  describe: 'View audit trail for a session',
  builder: (yargs) =>
    yargs
      .positional('session-id', {
        type: 'string',
        demandOption: true,
        describe: 'The session ID to retrieve audit events for',
      })
      .option('format', {
        type: 'string',
        choices: ['json', 'table'] as const,
        default: 'table',
        describe: 'Output format',
      }),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const sessionId = argv['sessionId'] as string;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const format = argv['format'] as 'json' | 'table';
    await runAudit({sessionId, format});
  },
};
