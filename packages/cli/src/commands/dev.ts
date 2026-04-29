/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import type {ChildProcess} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalServer, initLogLevel, interceptConsole, log} from '@amodalai/runtime';
import {ensureAdminAgent, getAdminAgentConfig, getAdminAgentVersion, checkRegistryVersion} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {createServer} from 'node:net';
import {runConnectionPreflight, printPreflightTable} from '../shared/connection-preflight.js';
import {resolveEnv} from '../shared/env-resolution.js';
import {getDb, ensureSchema, closeDb} from '@amodalai/db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RUNTIME_PORT = 3847;

// ---------------------------------------------------------------------------
// Port checking
// ---------------------------------------------------------------------------

function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => {
      reject(new Error(
        `Port ${String(port)} is already in use. Stop the process using it or pass --port to pick a different port.`,
      ));
    });
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve());
    });
  });
}

// ---------------------------------------------------------------------------
// Studio resolution
// ---------------------------------------------------------------------------

/**
 * Locate the @amodalai/studio package directory. Two strategies:
 * 1. Sibling directory relative to the CLI package (works when symlinked)
 * 2. Node module resolution via createRequire (works when installed)
 */
function resolveStudioDir(): string | null {
  // scriptDir is packages/cli/dist/src/commands/ at runtime (or packages/cli/src/commands/ in source)
  // CLI package root is 3 levels up, then ../studio is the sibling package
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const cliRoot = path.resolve(scriptDir, '..', '..', '..');
  const siblingCandidate = path.resolve(cliRoot, '..', 'studio');
  if (existsSync(path.join(siblingCandidate, 'package.json'))) {
    return siblingCandidate;
  }
  const require = createRequire(import.meta.url);
  try {
    return path.dirname(require.resolve('@amodalai/studio/package.json'));
  } catch (err: unknown) {
    log.debug('studio_resolve_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DevOptions {
  cwd?: string;
  port?: number;
  studioPort?: number;
  adminPort?: number;
  host?: string;
  resume?: string;
  verbose?: number;
  quiet?: boolean;
  /** Disable Studio subprocess. */
  noStudio?: boolean;
  /** Disable admin agent subprocess. */
  noAdmin?: boolean;
}

// ---------------------------------------------------------------------------
// Subprocess helpers
// ---------------------------------------------------------------------------

/** Managed subprocess with a label for log output. */
interface ManagedProcess {
  label: string;
  child: ChildProcess;
}

/**
 * Pipe a child process's stdout/stderr to the parent's stderr, prefixed
 * with a label. Lines are buffered per-stream to avoid interleaved output
 * from concurrent subprocesses.
 */
function pipeWithLabel(child: ChildProcess, label: string, opts?: {quiet?: boolean}): void {
  const prefix = `[${label}] `;
  const quiet = opts?.quiet ?? false;
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    let buffer = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (quiet && !line.includes('[WARN]') && !line.includes('[ERROR]') && !line.includes('Error')) continue;
        process.stderr.write(`${prefix}${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) {
        if (!quiet || buffer.includes('[WARN]') || buffer.includes('[ERROR]') || buffer.includes('Error')) {
          process.stderr.write(`${prefix}${buffer}\n`);
        }
        buffer = '';
      }
    });
  }
}

/**
 * Kill all managed subprocesses. Returns once all processes have exited
 * or after a 5-second timeout (whichever comes first).
 */
async function killAll(processes: ManagedProcess[]): Promise<void> {
  const KILL_TIMEOUT_MS = 5000;
  const exitPromises: Array<Promise<void>> = [];

  for (const {child, label} of processes) {
    if (child.exitCode !== null) continue; // already exited
    exitPromises.push(
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          log.warn('subprocess_kill_timeout', {label});
          child.kill('SIGKILL');
          resolve();
        }, KILL_TIMEOUT_MS);

        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });

        child.kill('SIGTERM');
      }),
    );
  }

  await Promise.all(exitPromises);
}

// ---------------------------------------------------------------------------
// Studio subprocess
// ---------------------------------------------------------------------------

interface StudioSpawnResult {
  process: ManagedProcess;
  url: string;
}

function spawnStudio(opts: {
  port: number;
  runtimePort: number;
  repoPath: string;
  agentId?: string;
  adminAgentUrl?: string;
}): StudioSpawnResult | null {
  const studioDir = resolveStudioDir();
  if (!studioDir) {
    log.info('studio_not_available', {
      hint: '@amodalai/studio package not found — Studio subprocess skipped',
    });
    return null;
  }

  const studioEnv: NodeJS.ProcessEnv = {
    ...process.env,
    REPO_PATH: opts.repoPath,
    STUDIO_CORS_ORIGINS: `http://localhost:${String(opts.runtimePort)}`,
    RUNTIME_URL: `http://localhost:${String(opts.runtimePort)}`,
    PORT: String(opts.port),
    HOSTNAME: '0.0.0.0',
    ...(opts.agentId ? {AGENT_ID: opts.agentId} : {}),
    ...(opts.adminAgentUrl ? {ADMIN_AGENT_URL: opts.adminAgentUrl} : {}),
  };

  // Pre-built server (npm install): dist-server/studio-server.js
  // Source mode (monorepo dev): src/server/studio-server.ts via tsx
  const prebuiltEntry = path.join(studioDir, 'dist-server', 'studio-server.js');
  const sourceEntry = path.join(studioDir, 'src', 'server', 'studio-server.ts');

  let spawnArgs: string[];

  if (existsSync(prebuiltEntry)) {
    log.debug('studio_prebuilt', {path: prebuiltEntry});
    spawnArgs = [prebuiltEntry];
  } else if (existsSync(sourceEntry)) {
    // Resolve tsx from the studio package's dependency tree
    const studioRequire = createRequire(path.join(studioDir, 'package.json'));
    let tsxBin: string;
    try {
      tsxBin = studioRequire.resolve('tsx/dist/cli.mjs');
    } catch {
      log.info('studio_tsx_not_found', {
        hint: 'tsx not resolvable from @amodalai/studio — Studio subprocess skipped',
      });
      return null;
    }
    log.info('studio_dev_mode', {tsxBin, entry: sourceEntry});
    spawnArgs = [tsxBin, sourceEntry];
  } else {
    log.info('studio_entry_not_found', {
      hint: 'Neither dist-server nor src/server found — Studio subprocess skipped',
    });
    return null;
  }

  const studioUrl = `http://localhost:${String(opts.port)}`;
  const child = spawn(
    process.execPath,
    spawnArgs,
    {
      cwd: studioDir,
      env: studioEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.once('error', (err) => {
    log.warn('studio_spawn_error', {error: err.message});
  });

  const label = 'studio';
  pipeWithLabel(child, label, {quiet: true});

  child.once('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      log.warn('subprocess_exited', {label, code});
    } else if (signal) {
      log.debug('subprocess_signaled', {label, signal});
    }
  });

  return {
    process: {label, child},
    url: studioUrl,
  };
}

// ---------------------------------------------------------------------------
// Admin agent subprocess
// ---------------------------------------------------------------------------

interface AdminSpawnResult {
  process: ManagedProcess;
  url: string;
}

async function spawnAdminAgent(opts: {
  port: number;
  studioUrl: string | null;
  repoPath: string;
}): Promise<AdminSpawnResult | null> {
  let adminAgentPath: string | null;
  try {
    adminAgentPath = await ensureAdminAgent(opts.repoPath);
  } catch (err: unknown) {
    log.warn('admin_agent_fetch_failed', {
      error: err instanceof Error ? err.message : String(err),
      hint: 'Could not download @amodalai/agent-admin — admin agent skipped',
    });
    return null;
  }

  const adminVersion = await getAdminAgentVersion(adminAgentPath);
  log.info('admin_agent_resolved', {path: adminAgentPath, version: adminVersion ?? 'unknown'});

  // Non-blocking upgrade check for unpinned admin agent
  void (async () => {
    try {
      const config = await getAdminAgentConfig(opts.repoPath);
      if (config.pathOverride || config.pinnedVersion) return;
      const cached = await getAdminAgentVersion(adminAgentPath);
      if (!cached) return;
      const registry = await checkRegistryVersion();
      if (registry && registry !== cached) {
        process.stderr.write(
          `[admin] Admin agent v${cached} — v${registry} available (run \`amodal update --admin-agent\` to upgrade)\n`,
        );
      }
    } catch {
      // Non-blocking — silently ignore
    }
  })().catch(() => {});

  // Verify the admin agent directory has an amodal.json
  if (!existsSync(path.join(adminAgentPath, 'amodal.json'))) {
    log.warn('admin_agent_invalid', {
      path: adminAgentPath,
      hint: 'Directory exists but has no amodal.json — skipped',
    });
    return null;
  }

  // Resolve the CLI entrypoint. We're running inside the CLI already, so
  // use the same executable to spawn the admin agent's dev server.
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const cliEntrypoint = path.resolve(scriptDir, '..', 'main.js');

  const adminUrl = `http://localhost:${String(opts.port)}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AMODAL_NO_ADMIN: '1',
    AMODAL_NO_STUDIO: '1',
    REPO_PATH: opts.repoPath,
  };
  if (opts.studioUrl) {
    env['STUDIO_URL'] = opts.studioUrl;
  }

  const child = spawn(
    process.execPath,
    [cliEntrypoint, 'dev', '--port', String(opts.port)],
    {
      cwd: adminAgentPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const label = 'admin';
  pipeWithLabel(child, label, {quiet: true});

  child.once('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      log.warn('subprocess_exited', {label, code});
    } else if (signal) {
      log.debug('subprocess_signaled', {label, signal});
    }
  });

  return {
    process: {label, child},
    url: adminUrl,
  };
}

// ---------------------------------------------------------------------------
// Main dev command
// ---------------------------------------------------------------------------

/**
 * Starts a local development server for the repo with hot reload enabled,
 * and optionally spawns Studio and admin agent as subprocesses.
 */
export async function runDev(options: DevOptions = {}): Promise<void> {
  initLogLevel({verbosity: options.verbose ?? 0, quiet: options.quiet ?? false});
  interceptConsole();

  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch {
    process.stderr.write(`
  No amodal.json found.

  Create a new agent:

    amodal init        Initialize this directory
    amodal dev         Start the dev server

  Or if your agent is in another directory:

    cd /path/to/agent && amodal dev

`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Require DATABASE_URL
  // -------------------------------------------------------------------------

  const databaseUrl = resolveEnv('DATABASE_URL', repoPath);
  if (!databaseUrl) {
    log.error('database_url_required', {});
    process.stderr.write(`
DATABASE_URL is required. Start Postgres and configure it:

  docker run -d --name amodal-pg -p 5432:5432 \\
    -e POSTGRES_DB=amodal -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17

Then set the connection string:

  echo 'DATABASE_URL=postgres://localhost:5432/amodal' >> ~/.amodal/.env

Or add it to your agent's .env file:

  echo 'DATABASE_URL=postgres://localhost:5432/amodal' >> .env

`);
    process.exit(1);
  }

  // Make DATABASE_URL available to child processes (runtime, Studio)
  process.env['DATABASE_URL'] = databaseUrl;

  // Read agent name from amodal.json for AGENT_ID
  const amodalJsonPath = path.join(repoPath, 'amodal.json');
  let agentId: string | undefined;
  if (existsSync(amodalJsonPath)) {
    try {
      const amodalJson: unknown = JSON.parse(readFileSync(amodalJsonPath, 'utf-8'));
      const parsed = typeof amodalJson === 'object' && amodalJson !== null
        ? amodalJson
        : undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse boundary: validated with typeof guard above
      const nameValue = parsed !== undefined ? (parsed as Record<string, unknown>)['name'] : undefined;
      if (typeof nameValue === 'string') {
        agentId = nameValue;
        process.env['AGENT_ID'] = agentId;
      }
    } catch (err: unknown) {
      log.warn('amodal_json_parse_error', {
        path: amodalJsonPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Run schema migrations
  // -------------------------------------------------------------------------

  try {
    const migrationDb = getDb(databaseUrl);
    await ensureSchema(migrationDb);
    await closeDb(); // Close migration connection — runtime and Studio open their own
    log.debug('schema_migration_complete', {});
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('schema_migration_failed', {error: msg});
    process.stderr.write(`[dev] Failed to run database migrations: ${msg}\n`);
    process.stderr.write('[dev] Is Postgres running and DATABASE_URL correct?\n');
    process.exit(1);
  }

  const host = options.host ?? '0.0.0.0';

  // -------------------------------------------------------------------------
  // Port allocation
  // -------------------------------------------------------------------------

  const runtimePort = options.port ?? DEFAULT_RUNTIME_PORT;
  const studioPort = options.studioPort ?? runtimePort + 1;
  const adminPort = options.adminPort ?? runtimePort + 2;

  await assertPortFree(runtimePort);
  if (!options.noStudio) await assertPortFree(studioPort);
  if (!options.noAdmin) await assertPortFree(adminPort);

  log.debug('ports_allocated', {
    runtime: runtimePort,
    studio: options.noStudio ? null : studioPort,
    admin: options.noAdmin ? null : adminPort,
  });

  // -------------------------------------------------------------------------
  // Spawn subprocesses
  // -------------------------------------------------------------------------

  const managedProcesses: ManagedProcess[] = [];
  let studioUrl: string | null = null;
  let adminAgentUrl: string | null = null;

  // Studio
  if (!options.noStudio) {
    const studioResult = spawnStudio({
      port: studioPort,
      runtimePort,
      repoPath,
      agentId,
      adminAgentUrl: options.noAdmin ? undefined : `http://localhost:${String(adminPort)}`,
    });
    if (studioResult) {
      managedProcesses.push(studioResult.process);
      studioUrl = studioResult.url;
    }
  }

  // Admin agent
  if (!options.noAdmin) {
    const adminResult = await spawnAdminAgent({
      port: adminPort,
      studioUrl,
      repoPath,
    });
    if (adminResult) {
      managedProcesses.push(adminResult.process);
      adminAgentUrl = adminResult.url;
    }
  }

  // -------------------------------------------------------------------------
  // Start the runtime server
  // -------------------------------------------------------------------------

  log.debug('starting_dev_server', {repoPath});

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
        log.debug('serving_prebuilt_app', {path: staticAppDir});
        staticAppDir = dir;
        break;
      }
    }

    const server = await createLocalServer({
      repoPath,
      port: runtimePort,
      host,
      hotReload: true,
      corsOrigin: '*',
      staticAppDir,
      resumeSessionId: options.resume,
      studioUrl: studioUrl ?? undefined,
      adminAgentUrl: adminAgentUrl ?? undefined,
    });

    await server.start();

    // Print clean startup summary
    process.stderr.write('\n');
    process.stderr.write(`  Runtime:     http://localhost:${String(runtimePort)}\n`);
    if (studioUrl) {
      process.stderr.write(`  Studio:      ${studioUrl}\n`);
    }
    if (adminAgentUrl) {
      process.stderr.write(`  Admin Agent: ${adminAgentUrl}\n`);
    }
    const redactedUrl = databaseUrl.replace(
      /\/\/([^:]+):([^@]+)@/,
      '//$1:***@',
    );
    process.stderr.write(`  Database:    ${redactedUrl}\n`);
    process.stderr.write('\n');

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

      // Kill subprocesses first
      if (managedProcesses.length > 0) {
        log.debug('subprocess_shutdown', {count: managedProcesses.length});
        await killAll(managedProcesses);
      }

      await server.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    // Kill any already-spawned subprocesses before exiting
    if (managedProcesses.length > 0) {
      await killAll(managedProcesses);
    }
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
    verbose: {
      alias: 'v',
      type: 'count',
      describe: 'Increase log verbosity (-v debug, -vv trace)',
      default: 0,
    },
    quiet: {
      alias: 'q',
      type: 'boolean',
      describe: 'Only show errors',
      default: false,
    },
    'studio-port': {
      type: 'number',
      describe: 'Port for Studio (defaults to port + 1)',
    },
    'admin-port': {
      type: 'number',
      describe: 'Port for admin agent (defaults to port + 2)',
    },
    'no-studio': {
      type: 'boolean',
      describe: 'Do not spawn Studio subprocess',
      default: false,
    },
    'no-admin': {
      type: 'boolean',
      describe: 'Do not spawn admin agent subprocess',
      default: false,
    },
  },
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const port = argv['port'] as number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const host = argv['host'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const resume = argv['resume'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const verbose = argv['verbose'] as number;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const quiet = argv['quiet'] as boolean;
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const studioPort = argv['studio-port'] as number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const adminPort = argv['admin-port'] as number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const noStudio = (argv['no-studio'] as boolean) || process.env['AMODAL_NO_STUDIO'] === '1';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const noAdmin = (argv['no-admin'] as boolean) || process.env['AMODAL_NO_ADMIN'] === '1';
    try {
      await runDev({port, studioPort, adminPort, host, resume, verbose, quiet, noStudio, noAdmin});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n  Error: ${msg}\n\n`);
      process.exit(1);
    }
  },
};
