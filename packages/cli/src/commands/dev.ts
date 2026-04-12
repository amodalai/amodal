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
import {resolveAdminAgent} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {findFreePort} from '../shared/find-free-port.js';
import {runConnectionPreflight, printPreflightTable} from '../shared/connection-preflight.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RUNTIME_PORT = 3847;
const DEFAULT_STUDIO_PORT = 3848;
const DEFAULT_ADMIN_PORT = 3849;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DevOptions {
  cwd?: string;
  port?: number;
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
function pipeWithLabel(child: ChildProcess, label: string): void {
  const prefix = `[${label}] `;
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    let buffer = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        process.stderr.write(`${prefix}${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) {
        process.stderr.write(`${prefix}${buffer}\n`);
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
}): StudioSpawnResult | null {
  // Resolve @amodalai/studio-app package directory
  let studioDir: string;
  try {
    const require = createRequire(import.meta.url);
    const studioPkg = require.resolve('@amodalai/studio-app/package.json');
    studioDir = path.dirname(studioPkg);
  } catch {
    log.info('studio_not_available', {
      hint: '@amodalai/studio-app package not found — Studio subprocess skipped',
    });
    return null;
  }

  // Resolve the `next` binary from the studio-app's dependency tree.
  // In pnpm the binary may live in the package's own node_modules or in a
  // hoisted location; createRequire resolves correctly in both cases.
  let nextBin: string;
  try {
    const studioRequire = createRequire(path.join(studioDir, 'package.json'));
    // next/dist/bin/next is the actual CLI entrypoint
    nextBin = studioRequire.resolve('next/dist/bin/next');
  } catch {
    log.info('studio_next_not_found', {
      hint: 'next binary not resolvable from @amodalai/studio-app — Studio subprocess skipped',
    });
    return null;
  }

  const studioUrl = `http://localhost:${String(opts.port)}`;
  const child = spawn(
    process.execPath,
    [nextBin, 'dev', '--port', String(opts.port)],
    {
      cwd: studioDir,
      env: {
        ...process.env,
        REPO_PATH: opts.repoPath,
        STUDIO_CORS_ORIGINS: `http://localhost:${String(opts.runtimePort)}`,
        PORT: String(opts.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.once('error', (err) => {
    log.warn('studio_spawn_error', {error: err.message});
  });

  const label = 'studio';
  pipeWithLabel(child, label);

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
  const adminAgentPath = await resolveAdminAgent(opts.repoPath);
  if (!adminAgentPath) {
    log.info('admin_agent_not_available', {
      hint: 'No admin agent found at ~/.amodal/admin-agent/ or in amodal.json — skipped',
    });
    return null;
  }

  // Verify it has an amodal.json (is a valid agent directory)
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
  pipeWithLabel(child, label);

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

  const host = options.host ?? '0.0.0.0';

  // -------------------------------------------------------------------------
  // Port allocation
  // -------------------------------------------------------------------------

  const runtimePort = await findFreePort(options.port ?? DEFAULT_RUNTIME_PORT);
  const studioPort = options.noStudio
    ? DEFAULT_STUDIO_PORT
    : await findFreePort(DEFAULT_STUDIO_PORT);
  const adminPort = options.noAdmin
    ? DEFAULT_ADMIN_PORT
    : await findFreePort(DEFAULT_ADMIN_PORT);

  log.info('ports_allocated', {
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

    // Print all URLs
    process.stderr.write('\n');
    process.stderr.write(`  Runtime:     http://localhost:${String(runtimePort)}\n`);
    if (studioUrl) {
      process.stderr.write(`  Studio:      ${studioUrl}\n`);
    }
    if (adminAgentUrl) {
      process.stderr.write(`  Admin Agent: ${adminAgentUrl}\n`);
    }
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
        log.info('subprocess_shutdown', {count: managedProcesses.length});
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
    const noStudio = argv['no-studio'] as boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const noAdmin = argv['no-admin'] as boolean;
    await runDev({port, host, resume, verbose, quiet, noStudio, noAdmin});
  },
};
