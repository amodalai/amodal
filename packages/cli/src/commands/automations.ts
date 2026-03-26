/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';

const DEFAULT_URL = 'http://localhost:3847';

interface AutomationEntry {
  name: string;
  title: string;
  schedule?: string;
  webhookTriggered: boolean;
  running: boolean;
}

async function fetchJson(url: string, method: 'GET' | 'POST' = 'GET'): Promise<unknown> {
  const res = await fetch(url, {method});
  const body = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON response
    const err = (body as Record<string, unknown>)['error'] ?? res.statusText;
    throw new Error(String(err));
  }
  return body;
}

export interface AutomationsOptions {
  url?: string;
  json?: boolean;
}

/**
 * List automations from a running server.
 */
export async function runAutomationsList(options: AutomationsOptions = {}): Promise<number> {
  const base = options.url ?? DEFAULT_URL;
  try {
    const data = await fetchJson(`${base}/automations`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON response
    const automations = (data as {automations: AutomationEntry[]}).automations;

    if (automations.length === 0) {
      process.stderr.write('[automations] No automations defined.\n');
      return 0;
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(automations, null, 2) + '\n');
      return 0;
    }

    const nameW = Math.max(4, ...automations.map((a) => a.name.length));
    const titleW = Math.max(5, ...automations.map((a) => a.title.length));
    const typeW = 8;
    const statusW = 7;

    const header = [
      'NAME'.padEnd(nameW),
      'TITLE'.padEnd(titleW),
      'TYPE'.padEnd(typeW),
      'STATUS'.padEnd(statusW),
      'SCHEDULE',
    ].join('   ');

    process.stdout.write(header + '\n');

    for (const a of automations) {
      const type = a.webhookTriggered ? 'webhook' : 'cron';
      const status = a.running ? 'running' : 'stopped';
      const row = [
        a.name.padEnd(nameW),
        a.title.padEnd(titleW),
        type.padEnd(typeW),
        status.padEnd(statusW),
        a.schedule ?? '-',
      ].join('   ');
      process.stdout.write(row + '\n');
    }

    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[automations] ${msg}\n`);
    return 1;
  }
}

/**
 * Start a cron automation on a running server.
 */
export async function runAutomationsStart(name: string, options: AutomationsOptions = {}): Promise<number> {
  const base = options.url ?? DEFAULT_URL;
  try {
    await fetchJson(`${base}/automations/${encodeURIComponent(name)}/start`, 'POST');
    process.stderr.write(`[automations] Started "${name}"\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[automations] ${msg}\n`);
    return 1;
  }
}

/**
 * Stop a running cron automation on a running server.
 */
export async function runAutomationsStop(name: string, options: AutomationsOptions = {}): Promise<number> {
  const base = options.url ?? DEFAULT_URL;
  try {
    await fetchJson(`${base}/automations/${encodeURIComponent(name)}/stop`, 'POST');
    process.stderr.write(`[automations] Stopped "${name}"\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[automations] ${msg}\n`);
    return 1;
  }
}

/**
 * Manually trigger an automation on a running server.
 */
export async function runAutomationsRun(name: string, options: AutomationsOptions = {}): Promise<number> {
  const base = options.url ?? DEFAULT_URL;
  try {
    await fetchJson(`${base}/automations/${encodeURIComponent(name)}/run`, 'POST');
    process.stderr.write(`[automations] Triggered "${name}"\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[automations] ${msg}\n`);
    return 1;
  }
}

export const automationsCommand: CommandModule = {
  command: 'automations <action> [name]',
  describe: 'Manage automations on a running server',
  builder: (yargs) =>
    yargs
      .positional('action', {
        type: 'string',
        choices: ['list', 'start', 'stop', 'run'] as const,
        describe: 'Action to perform',
      })
      .positional('name', {
        type: 'string',
        describe: 'Automation name (required for start/stop/run)',
      })
      .option('url', {
        type: 'string',
        describe: `Server URL (default: ${DEFAULT_URL})`,
      })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Output as JSON (list only)',
      }),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const action = argv['action'] as string;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const name = argv['name'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const url = argv['url'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const json = argv['json'] as boolean;

    let code: number;
    switch (action) {
      case 'list':
        code = await runAutomationsList({url, json});
        break;
      case 'start':
        if (!name) {
          process.stderr.write('[automations] Name required for start\n');
          process.exit(1);
        }
        code = await runAutomationsStart(name, {url});
        break;
      case 'stop':
        if (!name) {
          process.stderr.write('[automations] Name required for stop\n');
          process.exit(1);
        }
        code = await runAutomationsStop(name, {url});
        break;
      case 'run':
        if (!name) {
          process.stderr.write('[automations] Name required for run\n');
          process.exit(1);
        }
        code = await runAutomationsRun(name, {url});
        break;
      default:
        process.stderr.write(`[automations] Unknown action: ${action}\n`);
        code = 1;
        break;
    }
    process.exit(code);
  },
};
