/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import type {ChildProcess} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalServer, initLogLevel, interceptConsole, log} from '@amodalai/runtime';
import {ensureAdminAgent, getAdminAgentConfig, getAdminAgentVersion, checkRegistryVersion} from '@amodalai/core';
import {findRepoRootOrCwd} from '../shared/repo-discovery.js';
import {createServer} from 'node:net';
import {runConnectionPreflight, printPreflightTable} from '../shared/connection-preflight.js';
import {resolveEnv} from '../shared/env-resolution.js';
import {getDb, ensureSchema, closeDb} from '@amodalai/db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RUNTIME_PORT = 3847;
const DEFAULT_STUDIO_PORT = 3848;
const DEFAULT_ADMIN_PORT = 3849;

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
/**
 * Predicate for pipeWithLabel's quiet mode. Exported for unit tests so a
 * format change in the runtime logger can't silently break dev observability.
 *
 * Passes warnings/errors and the Phase 4 intent-routing telemetry through
 * (the latter is exactly what makes intent vs LLM ratios visible in dev).
 */
export function passesQuietFilter(line: string): boolean {
  return (
    line.includes('[WARN]') ||
    line.includes('[ERROR]') ||
    line.includes('Error') ||
    line.includes('intent_') ||
    line.includes('agent_loop_start') ||
    line.includes('route_intent') ||
    line.includes('route_llm')
  );
}

/**
 * Best-effort pretty-printer for routing telemetry. The runtime emits
 * `[INFO] route_intent {…json…}` style lines (for production aggregators);
 * in the dev terminal that's mostly visual noise. This rewrites the few
 * route/intent lifecycle events into one-liner status lines so a human
 * scanning their terminal can answer "is intent routing working?" at a
 * glance. Falls back to the original line when parsing fails so we never
 * eat a line that the user might need.
 *
 * Returns:
 *   - a string (possibly the same as input) — print it verbatim
 *   - null — suppress the line entirely (e.g. dropping intent_matched
 *     once route_intent has already been printed for the same turn)
 */
export function formatLineForDev(line: string): string | null {
  // Only touch our recognized events. Match `[LEVEL] event_name {json}` form.
  const m = /^\[(INFO|WARN|ERROR)\] ([a-z_]+) (\{.*\})\s*$/.exec(line);
  if (!m) return line;

  const [, , event, jsonStr] = m;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return line;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return line;
  }
  const data: Record<string, unknown> = Object.fromEntries(
    Object.entries(parsed),
  );

  const str = (k: string): string =>
    typeof data[k] === 'string' ? (data[k]) : '';
  const num = (k: string): number =>
    typeof data[k] === 'number' ? (data[k]) : 0;

  switch (event) {
    case 'route_intent': {
      const preview = str('userMessagePreview');
      return `→ INTENT  ${str('intentId').padEnd(22)} "${preview}"`;
    }
    case 'route_llm': {
      const reason = str('reason');
      const detail = str('intentId') || str('userMessagePreview');
      return `→ LLM     ${reason.padEnd(22)} ${detail ? `"${detail}"` : ''}`.trimEnd();
    }
    case 'intent_completed': {
      const toolCount = num('toolCount');
      const ms = num('durationMs');
      return `  ✓ ${str('intentId')} done (${String(toolCount)} tools, ${String(ms)}ms)`;
    }
    case 'intent_fell_through': {
      const ms = num('durationMs');
      return `  ↓ ${str('intentId')} fell through to LLM (${String(ms)}ms)`;
    }
    case 'intent_errored': {
      return `  ✗ ${str('intentId')} ERRORED: ${str('error')}`;
    }
    case 'intent_blocked_by_confirmation': {
      return `  ✗ ${str('intentId')} blocked: ${str('toolName')} requires confirmation`;
    }
    case 'intent_returned_null_after_committing': {
      return `  ⚠ ${str('intentId')} returned null after ${String(num('toolCallsStarted'))} tool calls — treating as completion`;
    }
    case 'intent_matched':
    case 'agent_loop_start': {
      // Both are redundant in dev: intent_matched duplicates the
      // route_intent line that fires a millisecond earlier, and
      // agent_loop_start always follows a route_llm line (manager.ts
      // emits route_llm immediately before invoking the LLM). Drop
      // them to keep the dev terminal scannable; production
      // aggregators still get them on stderr from the runtime
      // process directly (this formatter only runs in pipeWithLabel).
      return null;
    }
    case 'tool_log': {
      // Tools call ctx.log(...) for noteworthy progress (e.g.
      // install_template emits "Cloned whodatdev/template-X into
      // agent repo (N connection packages installed)"). When fired
      // during an intent run the callId starts with `intent_`, so
      // these lines pass the quiet filter — but as raw JSON they
      // bury the useful message inside callId/session noise. Strip
      // to a clean nested bullet.
      const msg = str('message');
      if (!msg) return null;
      return `    · ${msg}`;
    }
    default:
      return line;
  }
}

function pipeWithLabel(child: ChildProcess, label: string, opts?: {quiet?: boolean}): void {
  const prefix = `[${label}] `;
  const quiet = opts?.quiet ?? false;

  const writeLine = (line: string): void => {
    if (quiet && !passesQuietFilter(line)) return;
    const pretty = formatLineForDev(line);
    if (pretty === null) return;
    process.stderr.write(`${prefix}${pretty}\n`);
  };

  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    let buffer = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) writeLine(line);
    });
    stream.on('end', () => {
      if (buffer.length > 0) {
        writeLine(buffer);
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

  // Empty directories are allowed: the create flow in Studio scaffolds
  // amodal.json from a chosen template (or admin-agent conversation), so
  // the user can `amodal dev` before they have a project at all. We just
  // skip the runtime in that case — it can't loadRepo without a manifest.
  const {root: repoPath, hasManifest} = findRepoRootOrCwd(options.cwd);
  if (!hasManifest) {
    log.info('dev_create_flow_mode', {repoPath});
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

  // Resolve AGENT_ID — must be set BEFORE spawning subprocesses so
  // Studio, runtime, and admin-agent all key `setup_state` rows by
  // the same id. Three sources, in priority order:
  //   1. amodal.json#name when the file exists (post-setup repos)
  //   2. The repo dir basename (pre-setup repos — what the user calls
  //      their working directory; stable across the setup flow)
  //   3. 'default' as a last-ditch fallback
  // Without this, the admin-agent process would compute its own id
  // from its own bundle (name: "admin") and Studio's `getAgentId()`
  // would fall back to "default", leaving `commit_setup` marking a
  // different row than Studio reads — IndexPage would loop the user
  // back to /setup even after a successful commit.
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
      }
    } catch (err: unknown) {
      log.warn('amodal_json_parse_error', {
        path: amodalJsonPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (!agentId) {
    // Pre-setup fallback. `path.basename(repoPath)` gives "test-empty"
    // or whatever the user named their working dir — stable enough
    // for setup_state coordination, and the agent name will switch
    // to amodal.json#name on the next CLI invocation post-commit.
    agentId = path.basename(repoPath) || 'default';
  }
  process.env['AGENT_ID'] = agentId;

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
  const studioPort = DEFAULT_STUDIO_PORT;
  const adminPort = DEFAULT_ADMIN_PORT;

  if (hasManifest) {
    await assertPortFree(runtimePort);
  }
  if (!options.noStudio) await assertPortFree(studioPort);
  if (!options.noAdmin) await assertPortFree(adminPort);

  log.debug('ports_allocated', {
    runtime: hasManifest ? runtimePort : null,
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
  // Start the runtime server (skipped when there's no amodal.json — the
  // runtime can't loadRepo on an empty directory; the create flow in Studio
  // takes the user from an empty repo to a configured one, after which they
  // ctrl+C and re-run `amodal dev` to pick up the runtime).
  // -------------------------------------------------------------------------

  log.debug('starting_dev_server', {repoPath, hasManifest});

  try {
    let server: Awaited<ReturnType<typeof createLocalServer>> | null = null;

    /**
     * Boot the runtime server. Factored out so the empty-repo
     * branch (Phase E.9) can call it lazily when amodal.json lands.
     */
    const bootRuntime = async (): Promise<typeof server> => {
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

      const created = await createLocalServer({
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
      await created.start();
      return created;
    };

    if (hasManifest) {
      server = await bootRuntime();
    }

    // Print clean startup summary
    process.stderr.write('\n');
    if (server) {
      process.stderr.write(`  Runtime:     http://localhost:${String(runtimePort)}\n`);
    } else {
      process.stderr.write('  Runtime:     waiting for amodal.json (auto-boots when Studio finishes setup)\n');
    }
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

    // Preflight connection check (non-blocking) — only meaningful when
    // there's a manifest to load connections from.
    if (hasManifest) {
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

    // -------------------------------------------------------------------
    // Phase E.9 — runtime auto-(re)spawn on amodal.json change.
    //
    // Two flows watched by the same poller:
    //
    //   1. AUTO-BOOT — runtime didn't start at CLI launch (no manifest
    //      yet). Once amodal.json lands (commit_setup, the user-button
    //      commit-setup endpoint, or init-repo's skip-onboarding
    //      write), boot the runtime in place. Studio's runtime URL
    //      probe picks it up on the next tick.
    //
    //   2. AUTO-RESTART — runtime is already up but amodal.json has
    //      been rewritten since the last spawn. Happens after a
    //      Restart-Setup → re-commit, or when the user edits
    //      amodal.json by hand (adding a connection package, etc.).
    //      Without a restart, the running runtime keeps the stale
    //      bundle in memory and the new packages/config never load.
    //
    // 500ms debounce after detecting a change — lets the writer
    // (commit_setup's atomic rename, init-repo's full write) settle
    // before loadRepo tries to read.
    // -------------------------------------------------------------------

    const RUNTIME_WATCH_INTERVAL_MS = 2_000;
    let runtimeWatcher: ReturnType<typeof setTimeout> | null = null;
    let lastManifestMtime: number | null = null;

    const stopRuntimeWatch = (): void => {
      if (runtimeWatcher !== null) {
        clearTimeout(runtimeWatcher);
        runtimeWatcher = null;
      }
    };

    const manifestPath = path.join(repoPath, 'amodal.json');

    /**
     * Read the manifest's last-modified timestamp without throwing.
     * Returns null when the file is missing.
     */
    const manifestMtime = (): number | null => {
      try {
        if (!existsSync(manifestPath)) return null;
        return statSync(manifestPath).mtimeMs;
      } catch {
        return null;
      }
    };

    // Seed lastManifestMtime if the runtime was booted at startup so
    // we don't immediately self-restart on the first poll.
    if (server) lastManifestMtime = manifestMtime();

    const watchForRuntime = (): void => {
      const mtime = manifestMtime();
      const exists = mtime !== null;

      // Auto-boot path: no runtime yet, manifest just appeared.
      if (!server && exists) {
        runtimeWatcher = setTimeout(() => {
          (async () => {
            try {
              process.stderr.write('\n[dev] amodal.json appeared — booting runtime...\n');
              server = await bootRuntime();
              lastManifestMtime = manifestMtime();
              process.stderr.write(`  Runtime:     http://localhost:${String(runtimePort)}\n\n`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(`[dev] Runtime auto-boot failed: ${msg}\n`);
              process.stderr.write('       Try ctrl+C and re-running `amodal dev`.\n');
            }
          })().catch(() => undefined);
        }, 500);
        return;
      }

      // Auto-restart path: runtime is up, manifest was rewritten.
      if (server && exists && lastManifestMtime !== null && mtime > lastManifestMtime) {
        const previousServer = server;
        // Clear server immediately so a second mtime change while
        // we're restarting doesn't re-enter this branch.
        server = null;
        runtimeWatcher = setTimeout(() => {
          (async () => {
            try {
              process.stderr.write('\n[dev] amodal.json changed — restarting runtime...\n');
              await previousServer.stop();
              server = await bootRuntime();
              lastManifestMtime = manifestMtime();
              process.stderr.write(`  Runtime:     http://localhost:${String(runtimePort)} (restarted)\n\n`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(`[dev] Runtime restart failed: ${msg}\n`);
              process.stderr.write('       Try ctrl+C and re-running `amodal dev`.\n');
            }
          })().catch(() => undefined);
        }, 500);
        return;
      }

      runtimeWatcher = setTimeout(watchForRuntime, RUNTIME_WATCH_INTERVAL_MS);
    };

    runtimeWatcher = setTimeout(watchForRuntime, RUNTIME_WATCH_INTERVAL_MS);

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      process.stderr.write(`\n[dev] Received ${signal}, shutting down...\n`);

      stopRuntimeWatch();

      // Kill subprocesses first
      if (managedProcesses.length > 0) {
        log.debug('subprocess_shutdown', {count: managedProcesses.length});
        await killAll(managedProcesses);
      }

      if (server) {
        await server.stop();
      }
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
    const noStudio = (argv['no-studio'] as boolean) || process.env['AMODAL_NO_STUDIO'] === '1';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const noAdmin = (argv['no-admin'] as boolean) || process.env['AMODAL_NO_ADMIN'] === '1';
    try {
      await runDev({port, host, resume, verbose, quiet, noStudio, noAdmin});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n  Error: ${msg}\n\n`);
      process.exit(1);
    }
  },
};
