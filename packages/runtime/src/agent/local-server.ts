/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

 

/**
 * Local server for repo-based agent mode.
 *
 * Loads the `.amodal/` config from `config.repoPath`, creates a
 * StandaloneSessionManager, mounts all routes, and optionally watches
 * for config changes (hot reload).
 */

import express from 'express';
import type http from 'node:http';
import {existsSync, readFileSync, mkdirSync, writeFileSync, watch} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

/**
 * Walk upward from a file path until we find the directory containing
 * package.json. Used by /api/getting-started to map a connection's
 * `location` (which points at `…/connections/<name>/`) back to its npm
 * package root so we can read its amodal block.
 */
function findPackageRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Read version from package.json at module load time so /api/config
// always reflects the actual deployed runtime version.
const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_VERSION: string = (() => {
  try {
    // Walk up from dist/src/agent/ to find package.json at package root.
    for (let dir = __runtimeDir; dir !== path.dirname(dir); dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'package.json');
      if (existsSync(candidate)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse at build-time boundary
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {name?: string; version?: string};
        if (pkg.name === '@amodalai/runtime') return pkg.version ?? '0.0.0';
      }
    }
  } catch { /* fall through */ }
  return '0.0.0';
})();
import {loadRepo} from '@amodalai/core';
import type {AgentBundle} from '@amodalai/types';
import {StandaloneSessionManager} from '../session/manager.js';
import {selectSessionStore} from '../session/session-store-selector.js';
import {resolveEnvRef} from '../env-ref.js';
import {buildSessionComponents} from '../session/session-builder.js';
import type {SharedResources, BundleResolver} from '../routes/session-resolver.js';
import {LocalToolExecutor} from './tool-executor-local.js';
import {buildMcpConfigs} from './mcp-config.js';
import {ConfigWatcher} from './config-watcher.js';
import {RuntimeEventBus} from '../events/event-bus.js';
import {createEventsRouter} from '../events/events-route.js';
import {wrapStoreBackendWithEvents} from '../events/store-event-wrapper.js';
import {createChatStreamRouter} from '../routes/chat-stream.js';
import {createChatRouter} from '../routes/chat.js';
import {createTaskRouter} from './routes/task.js';
import {createInspectRouter} from './routes/inspect.js';
import {createPackageUpdatesRouter} from './routes/package-updates.js';
import {createFeedbackRouter} from './routes/feedback.js';
import {FeedbackStore} from './feedback-store.js';
import {createStoresRouter} from './routes/stores.js';
import {createSessionsHistoryRouter} from '../routes/sessions-history.js';
import {createFilesRouter} from './routes/files.js';
import {createContextRouter} from './routes/context.js';
import {createEvalRouter} from '../routes/evals.js';
import {errorHandler} from '../middleware/error-handler.js';
import {asyncHandler} from '../routes/route-helpers.js';
import type {LocalServerConfig} from './agent-types.js';
import type {ServerInstance} from '../server.js';
import {createPostgresStoreBackend} from '../stores/postgres-store-backend.js';
import type {StoreBackend} from '@amodalai/types';
import {getDb, ensureSchema, closeDb, eq, sql, agentMemoryEntries} from '@amodalai/db';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {buildPages} from './page-builder.js';
import type {BuiltPage} from './page-builder.js';
import {LOCAL_APP_ID as DEFAULT_APP_ID} from '../constants.js';
import {log, createLogger} from '../logger.js';
import {detectProviderFromEnv} from '../config.js';
import {defaultRoleProvider} from '../role-provider.js';
import {bootstrapChannels} from '../channels/bootstrap.js';
import {DrizzleChannelSessionMapper} from '../channels/channel-session-mapper.js';
import type {ChannelAdapter} from '@amodalai/types';

// ---------------------------------------------------------------------------
// Provider verification (background, non-blocking)
// ---------------------------------------------------------------------------

interface ProviderStatus {
  provider: string;
  envVar: string;
  keySet: boolean;
  verified: boolean;
  error?: string;
}

// Each check must use an endpoint that returns 200 on a valid key and
// a distinct auth-failure status (typically 401) on a bad key. Do NOT
// use endpoints with method guards that might return 405 before the
// auth check — `GET /v1/messages` on Anthropic does exactly that, and
// makes every key (good or bad) look invalid because Anthropic returns
// 405 for wrong-method regardless of whether the x-api-key is real.
const PROVIDER_CHECKS = [
  {provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY', url: 'https://api.anthropic.com/v1/models', authHeader: (key: string) => ({'x-api-key': key, 'anthropic-version': '2023-06-01'})},
  {provider: 'openai', envVar: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/models', authHeader: (key: string) => ({Authorization: `Bearer ${key}`})},
  {provider: 'google', envVar: 'GOOGLE_API_KEY', url: 'https://generativelanguage.googleapis.com/v1beta/models', authHeader: (key: string) => ({'x-goog-api-key': key})},
  {provider: 'groq', envVar: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/models', authHeader: (key: string) => ({Authorization: `Bearer ${key}`})},
  {provider: 'deepseek', envVar: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/v1/models', authHeader: (key: string) => ({Authorization: `Bearer ${key}`})},
  {provider: 'xai', envVar: 'XAI_API_KEY', url: 'https://api.x.ai/v1/models', authHeader: (key: string) => ({Authorization: `Bearer ${key}`})},
];

async function checkProviders(): Promise<ProviderStatus[]> {
  const results = await Promise.allSettled(
    PROVIDER_CHECKS.map(async (check) => {
      const key = process.env[check.envVar];
      if (!key) {
        return {provider: check.provider, envVar: check.envVar, keySet: false, verified: false};
      }
      try {
        const res = await globalThis.fetch(check.url, {
          method: 'GET',
          headers: check.authHeader(key),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return {provider: check.provider, envVar: check.envVar, keySet: true, verified: true};
        }
        return {provider: check.provider, envVar: check.envVar, keySet: true, verified: false, error: `HTTP ${String(res.status)}`};
      } catch (err) {
        return {provider: check.provider, envVar: check.envVar, keySet: true, verified: false, error: err instanceof Error ? err.message : String(err)};
      }
    }),
  );

  return results.map((r) => r.status === 'fulfilled' ? r.value : {provider: 'unknown', envVar: '', keySet: false, verified: false});
}

// ---------------------------------------------------------------------------
// Local server
// ---------------------------------------------------------------------------

/**
 * Creates an Express server for repo-based agent mode.
 *
 * Loads the `.amodal/` config from `config.repoPath`, creates a
 * `StandaloneSessionManager`, mounts all routes, and optionally watches
 * for config changes (hot reload).
 */
/**
 * Install a process-level unhandledRejection listener that logs instead
 * of crashing. An escaped rejection is always a bug — we want loud logs,
 * not silent outages. The previous behavior (default Node: print + crash)
 * turned small bugs (one leaked promise) into whole-server downtime for
 * every active session. Logging + continuing preserves service for all
 * other sessions while still surfacing the issue to operators.
 *
 * Idempotent: only installs once per process (the local-server can be
 * created and torn down repeatedly during tests).
 */
let unhandledRejectionListenerInstalled = false;
function installUnhandledRejectionLogger(): void {
  if (unhandledRejectionListenerInstalled) return;
  unhandledRejectionListenerInstalled = true;
  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error('unhandled_rejection', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  });
}

export async function createLocalServer(config: LocalServerConfig): Promise<ServerInstance> {
  installUnhandledRejectionLogger();
  let bundle = await loadRepo({localPath: config.repoPath});

  // Auto-detect model from environment if not configured
  if (!bundle.config.models?.main) {
    const detected = detectProviderFromEnv();
    if (detected) {
      bundle = {
        ...bundle,
        config: {
          ...bundle.config,
          models: {...(bundle.config.models ?? {}), main: detected},
        },
      };
      log.debug('provider_auto_detected', {provider: detected.provider, model: detected.model});
    }
  }

  // Derive appId from the agent name (matches AGENT_ID env var set by CLI,
  // which Studio uses for its queries). Falls back to 'local' for unnamed agents.
  const appId = bundle.config.name || DEFAULT_APP_ID;

  // Check provider API keys in the background at startup
  let providerStatuses: ProviderStatus[] = PROVIDER_CHECKS.map((c) => ({
    provider: c.provider, envVar: c.envVar, keySet: !!process.env[c.envVar], verified: false,
  }));
  void checkProviders().then((results) => {
    providerStatuses = results;
    const verified = results.filter((r) => r.verified).map((r) => r.provider);
    if (verified.length > 0) {
      log.debug('provider_keys_verified', {providers: verified});
    }
    const failed = results.filter((r) => r.keySet && !r.verified);
    for (const f of failed) {
      log.warn('provider_key_invalid', {provider: f.provider, error: f.error});
    }
  }).catch((err: unknown) => {
    log.error('provider_check_failed', {error: err instanceof Error ? err.message : String(err)});
  });

  // Create custom tool executor
  const toolExecutor = bundle.tools.length > 0 ? new LocalToolExecutor() : undefined;

  // -------------------------------------------------------------------------
  // Database initialization (shared Postgres via @amodalai/db)
  // -------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- getDb returns Db which extends NodePgDatabase
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await ensureSchema(db);
  log.debug('database_schema_ready', {});

  // Migrate legacy 'local' appId to the agent name. Prior versions used a
  // hardcoded 'local' value; now we use the agent name for alignment with
  // Studio and cloud. This is safe in local dev (all 'local' data belongs
  // to this instance) and a no-op in cloud (no 'local' rows exist).
  // Uses conflict-safe SQL to avoid unique constraint violations on re-runs.
  if (appId !== DEFAULT_APP_ID) {
    await db.execute(sql`UPDATE store_documents SET app_id = ${appId} WHERE app_id = 'local' AND NOT EXISTS (SELECT 1 FROM store_documents sd2 WHERE sd2.app_id = ${appId} AND sd2.store = store_documents.store AND sd2.key = store_documents.key)`);
    await db.execute(sql`DELETE FROM store_documents WHERE app_id = 'local'`);
    await db.execute(sql`UPDATE store_document_versions SET app_id = ${appId} WHERE app_id = 'local'`);
    await db.update(agentMemoryEntries).set({appId}).where(eq(agentMemoryEntries.appId, 'local'));
    await db.execute(
      sql`UPDATE agent_sessions SET metadata = jsonb_set(metadata, '{appId}', to_jsonb(${appId}::text)) WHERE metadata->>'appId' = 'local'`,
    );
    log.debug('legacy_appid_migrated', {from: 'local', to: appId});
  }

  // -------------------------------------------------------------------------
  // Store backend
  // -------------------------------------------------------------------------

  let storeBackend: StoreBackend | undefined;
  const storeBackendType = bundle.stores.length > 0 ? 'postgres' : 'none';
  if (bundle.stores.length > 0) {
    try {
      storeBackend = await createPostgresStoreBackend(bundle.stores);
      log.info('store_backend_ready', {type: 'postgres', storeCount: bundle.stores.length});
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error('store_backend_init_failed', {error: errMsg});
    }
  }

  // -------------------------------------------------------------------------
  // Runtime event bus (powers /api/events SSE for live UI updates)
  // -------------------------------------------------------------------------

  const eventBus = new RuntimeEventBus({
    onListenerError: (err, event) => {
      log.warn('event_bus_listener_error', {
        seq: event.seq,
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  });

  // Wrap the store backend so every write emits store_updated events.
  // Covers every write path through one seam: tools, REST routes, admin
  // file tools, task execution — they all go through this backend.
  if (storeBackend) {
    storeBackend = wrapStoreBackendWithEvents(storeBackend, eventBus);
  }

  // -------------------------------------------------------------------------
  // Session manager (new standalone stack)
  // -------------------------------------------------------------------------

  const sessionLogger = createLogger({component: 'session-manager'});
  const sessionDataDir = `${config.repoPath}/.amodal/session-data`;
  const sessionStore = await selectSessionStore({
    backend: bundle.config.stores?.backend,
    postgresUrl: resolveEnvRef(bundle.config.stores?.postgresUrl),
    logger: sessionLogger,
    dataDir: sessionDataDir,
  });

  const sessionManager = new StandaloneSessionManager({
    logger: sessionLogger,
    store: sessionStore,
    ttlMs: config.sessionTtlMs,
    eventBus,
  });
  sessionManager.start();

  // -------------------------------------------------------------------------
  // MCP connections (shared across sessions)
  // -------------------------------------------------------------------------

  let mcpManager: import('@amodalai/core').McpManager | null = null;
  {
    const {McpManager} = await import('@amodalai/core');
    const mcpConfigs = buildMcpConfigs(bundle);
    if (Object.keys(mcpConfigs).length > 0) {
      const manager = new McpManager();
      try {
        await manager.startServers(mcpConfigs);
        if (manager.connectedCount > 0) {
          mcpManager = manager;
          const tools = manager.getDiscoveredTools();
          log.info('mcp_initialized', {servers: manager.connectedCount, tools: tools.length});
        }
      } catch (err) {
        log.error('mcp_init_failed', {error: err instanceof Error ? err.message : String(err)});
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shared resources for route handlers
  // -------------------------------------------------------------------------

  const shared: SharedResources = {
    storeBackend: storeBackend ?? null,
    mcpManager,
    logger: log,
    toolExecutor,
    appId,
    // Provide the DB handle for the memory tool when memory is enabled.
    // The db singleton is already initialized above (getDb + ensureSchema).
    ...(bundle.config.memory?.enabled ? {memoryDb: db} : {}),
  };

  // Helper: get current bundle (updated by config watcher)
  const getBundle = (): AgentBundle => bundle;

  // Bundle resolver uses a getter so routes always see the latest bundle
  // after config-watcher hot reloads.
  const bundleResolver: BundleResolver = {
    get staticBundle() { return bundle; },
  };

  // Helper: create task session components
  const createTaskSessionComponents = () => {
    const components = buildSessionComponents({
      bundle,
      storeBackend: storeBackend ?? null,
      mcpManager,
      logger: log,
      toolExecutor,
      sessionType: 'automation',
    });
    const session = sessionManager.create({
      provider: components.provider,
      toolRegistry: components.toolRegistry,
      permissionChecker: components.permissionChecker,
      systemPrompt: components.systemPrompt,
      toolContextFactory: components.toolContextFactory,
      appId,
      intents: components.intents,
    });
    return {session, toolContextFactory: components.toolContextFactory};
  };

  // -------------------------------------------------------------------------
  // Channel plugins (messaging integrations)
  // -------------------------------------------------------------------------

  let channelsResult: {adapters: Map<string, ChannelAdapter>; router: import('express').Router} | null = null;

  if (bundle.channels && bundle.channels.length > 0) {
    // The Postgres factory returns DrizzleSessionStore which
    // exposes `db` for sharing the connection pool with channel mappers.
    const {DrizzleSessionStore} = await import('../session/drizzle-session-store.js');
    if (!(sessionStore instanceof DrizzleSessionStore)) {
      throw new Error('Channels require a Drizzle-backed session store (postgres)');
    }
    const storeDb = sessionStore.db;
    const channelSessionMapper = new DrizzleChannelSessionMapper({
      db: storeDb,
      logger: log,
      eventBus,
    });

    try {
      channelsResult = await bootstrapChannels({
        channels: bundle.channels,
        repoPath: config.repoPath,
        packages: bundle.config.packages?.map((e) => (typeof e === 'string' ? e : e.package)),
        sessionMapper: channelSessionMapper,
        sessionManager,
        buildSessionComponents: () => buildSessionComponents({
          bundle,
          storeBackend: storeBackend ?? null,
          mcpManager,
          logger: log,
          toolExecutor,
          sessionType: 'chat',
        }),
        appId,
        eventBus,
        logger: log,
      });
    } catch (err) {
      log.warn('channels_load_failed', {
        error: err instanceof Error ? err.message : String(err),
        hint: 'Server will start without messaging channels',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Config watcher (hot reload)
  // -------------------------------------------------------------------------

  let watcher: ConfigWatcher | null = null;

  // -------------------------------------------------------------------------
  // Express app
  // -------------------------------------------------------------------------

  const app = express();

  // CORS
  const corsOrigin = config.corsOrigin ?? '*';
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    );
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // Health
  const startedAt = Date.now();
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: 'repo',
      repo_path: config.repoPath,
      uptime_ms: Date.now() - startedAt,
      active_sessions: sessionManager.size,
    });
  });

  // Auth token endpoint — local dev has no auth system.
  // Return 404 so the frontend falls into the "no auth" path
  // (sets token='local', status='none', all data hooks fire).
  // Cloud deployments override this with a real auth handler.
  app.post('/auth/token', (_req, res) => {
    res.status(404).json({error: 'No auth configured'});
  });

  // RoleProvider — defaults to "everyone is ops" for amodal dev.
  // Self-hosted ISVs can plug in their own provider to gate routes by role.
  const roleProvider = config.roleProvider ?? defaultRoleProvider;

  // GET /api/me — current user's role. Used by the runtime-app frontend
  // to decide which nav items / pages to show. In `amodal dev` this always
  // returns ops.
  app.get('/api/me', asyncHandler(async (req, res) => {
    const user = await roleProvider.resolveUser(req);
    if (!user) {
      log.warn('api_me_unauthenticated', {path: req.path});
      res.status(401).json({
        error: {code: 'unauthenticated', message: 'Authentication required'},
      });
      return;
    }
    res.json(user);
  }));

  // Runtime context — tells the SPA where Studio and admin agent live.
  // Resolved from LocalServerConfig (which reads env vars at the boundary).
  app.use(createContextRouter({
    studioUrl: config.studioUrl ?? process.env['STUDIO_URL'] ?? null,
    adminAgentUrl: config.adminAgentUrl ?? process.env['ADMIN_AGENT_URL'] ?? null,
  }));

  // ---- OAuth broker (local) ----------------------------------------------
  //
  // Per-package OAuth flows hosted in the runtime itself. Sally registers
  // her own OAuth app at the provider, drops `<APPKEY>_CLIENT_ID` and
  // `<APPKEY>_CLIENT_SECRET` into her local env, and the runtime brokers
  // the redirect dance entirely on localhost. Resulting tokens are
  // persisted to `.amodal/secrets.env` (auto-loaded on next startup) and
  // pushed into the running process.env immediately so the agent picks
  // them up without a restart.
  //
  // The cloud uses the platform-api's broker instead — same protocol,
  // different home.

  /** Pending OAuth state — keyed by random nonce, TTL ~10 min. */
  type PendingOauth = {
    packageName: string;
    appKey: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    envVars: Record<string, string>;
    createdAt: number;
  };
  const pendingOauth = new Map<string, PendingOauth>();
  const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

  function reapExpiredOauthStates(): void {
    const now = Date.now();
    for (const [k, v] of pendingOauth) {
      if (now - v.createdAt > OAUTH_STATE_TTL_MS) pendingOauth.delete(k);
    }
  }

  /**
   * Look up `amodal.oauth` for a package by walking each loaded
   * connection's location back to its package.json. Returns the parsed
   * oauth block + display-friendly metadata.
   */
  function readPackageOauth(packageName: string): {
    oauth: {
      appKey: string;
      authorizeUrl: string;
      tokenUrl: string;
      scopes?: string[];
      scopeSeparator?: string;
    };
    envVars: Record<string, string>;
  } | null {
    const bundleData = getBundle();
    for (const conn of bundleData.connections.values()) {
      const pkgDir = findPackageRoot(conn.location);
      if (!pkgDir) continue;
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing trusted local JSON
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
          name?: string;
          amodal?: {
            oauth?: { appKey: string; authorizeUrl: string; tokenUrl: string; scopes?: string[]; scopeSeparator?: string };
            auth?: { envVars?: Record<string, string> };
          };
        };
        if (pkg.name !== packageName || !pkg.amodal?.oauth) continue;
        return {
          oauth: pkg.amodal.oauth,
          envVars: pkg.amodal.auth?.envVars ?? {},
        };
      } catch (err: unknown) {
        log.warn('malformed_package_json', {path: pkgJsonPath, error: err instanceof Error ? err.message : String(err)});
      }
    }
    return null;
  }

  /**
   * Append/replace KEY=value in `<repoPath>/.amodal/secrets.env`. We use
   * a runtime-managed file rather than the user's `.env` to avoid
   * stomping their hand-edited values.
   */
  function persistSecret(name: string, value: string): void {
    const dir = path.join(config.repoPath, '.amodal');
    const file = path.join(dir, 'secrets.env');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let content = existsSync(file) ? readFileSync(file, 'utf-8') : '';
    // Replace existing line if present, otherwise append.
    const lines = content.split('\n').filter((l) => !l.startsWith(`${name}=`));
    lines.push(`${name}=${value}`);
    content = lines.filter((l) => l.length > 0).join('\n') + '\n';
    writeFileSync(file, content, { mode: 0o600 });
    log.info('secret_persisted', {name, file});
  }

  /**
   * Map raw token-exchange response onto the package's declared envVars.
   * Heuristic: `*REFRESH*` → refresh_token, `*ACCESS*`/everything else →
   * access_token. Mirrors the CLI's mapTokensToEnvVars.
   */
  function mapTokensToEnvVars(
    tokens: Record<string, unknown>,
    envVars: Record<string, string>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of Object.keys(envVars)) {
      const lower = name.toLowerCase();
      if (lower.includes('refresh') && typeof tokens['refresh_token'] === 'string') {
        out[name] = tokens['refresh_token'];
      } else if (typeof tokens['access_token'] === 'string') {
        out[name] = tokens['access_token'];
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // /api/oauth/start + /api/oauth/callback — DEPRECATED
  //
  // OAuth start/callback moved to Studio (packages/studio/src/server/routes/oauth.ts).
  // Studio is the boot surface — it's up before `amodal.json` exists, so the
  // setup-time Configure flow can run before this runtime even starts. The
  // runtime now watches `<repoPath>/.amodal/secrets.env` for changes and
  // reloads `process.env` automatically when Studio writes a new credential.
  //
  // These handlers stay in for backward compat (any older Studio build or
  // direct caller) but are no longer the canonical path. Plan: remove after
  // one release.
  // ---------------------------------------------------------------------------
  app.get('/api/oauth/start', (req, res) => {
    void (async () => {
      reapExpiredOauthStates();
      const packageName = typeof req.query['package'] === 'string' ? req.query['package'] : '';
      if (!packageName) {
        res.status(400).json({ error: 'package query param required' });
        return;
      }
      const meta = readPackageOauth(packageName);
      if (!meta) {
        res.status(404).json({ error: `${packageName} has no amodal.oauth metadata` });
        return;
      }
      const upper = meta.oauth.appKey.toUpperCase().replace(/-/g, "_");
      const clientId = process.env[`${upper}_CLIENT_ID`];
      const clientSecret = process.env[`${upper}_CLIENT_SECRET`];
      if (!clientId || !clientSecret) {
        log.warn('oauth_missing_credentials', {packageName, appKey: upper});
        res.status(400).json({
          error: `Missing ${upper}_CLIENT_ID or ${upper}_CLIENT_SECRET in env. Register your own OAuth app and set them in .env, or use the cloud broker.`,
        });
        return;
      }
      // Build the local callback URL using the inbound request's host so
      // the redirect lands back on the same runtime that's hosting Sally.
      const protoHeader = req.headers['x-forwarded-proto'];
      const proto = typeof protoHeader === 'string' ? protoHeader : 'http';
      const host = req.headers.host ?? `localhost:${String(config.port ?? 3847)}`;
      const redirectUri = `${proto}://${host}/api/oauth/callback`;
      const state = randomUUID();
      pendingOauth.set(state, {
        packageName,
        appKey: meta.oauth.appKey,
        tokenUrl: meta.oauth.tokenUrl,
        clientId,
        clientSecret,
        redirectUri,
        envVars: meta.envVars,
        createdAt: Date.now(),
      });
      const url = new URL(meta.oauth.authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      if (meta.oauth.scopes && meta.oauth.scopes.length > 0) {
        const sep = meta.oauth.scopeSeparator ?? ' ';
        url.searchParams.set('scope', meta.oauth.scopes.join(sep));
      }
      log.info('oauth_flow_started', {packageName, appKey: meta.oauth.appKey});
      res.json({ authorizeUrl: url.toString() });
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    });
  });

  app.get('/api/oauth/callback', (req, res) => {
    void (async () => {
      reapExpiredOauthStates();
      const code = typeof req.query['code'] === 'string' ? req.query['code'] : '';
      const state = typeof req.query['state'] === 'string' ? req.query['state'] : '';
      const errParam = typeof req.query['error'] === 'string' ? req.query['error'] : '';
      const studioUrl = config.studioUrl ?? process.env['STUDIO_URL'] ?? '';
      const studioReturn = (params: URLSearchParams): string => {
        if (!studioUrl) return `/?${params.toString()}`;
        return `${studioUrl}/agents/${appId}/connections?${params.toString()}`;
      };
      if (errParam) {
        log.warn('oauth_provider_error', {error: errParam});
        res.redirect(studioReturn(new URLSearchParams({ error: 'oauth_failed', message: errParam })));
        return;
      }
      const pending = pendingOauth.get(state);
      if (!pending || !code) {
        log.warn('oauth_invalid_callback', {hasState: !!pending, hasCode: !!code});
        res.redirect(studioReturn(new URLSearchParams({ error: 'oauth_failed', message: 'unknown state or missing code' })));
        return;
      }
      pendingOauth.delete(state);
      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: pending.redirectUri,
          client_id: pending.clientId,
          client_secret: pending.clientSecret,
        });
        const tokenResp = await fetch(pending.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!tokenResp.ok) {
          const text = await tokenResp.text().catch(() => '');
          throw new Error(`token exchange failed: HTTP ${String(tokenResp.status)} ${text}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        const tokens = (await tokenResp.json()) as Record<string, unknown>;
        const credentials = mapTokensToEnvVars(tokens, pending.envVars);
        for (const [name, value] of Object.entries(credentials)) {
          process.env[name] = value;
          persistSecret(name, value);
        }
        log.info('oauth_token_exchanged', {packageName: pending.packageName, envVarsSet: Object.keys(credentials)});
        res.redirect(studioReturn(new URLSearchParams({ connected: pending.packageName })));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('oauth_token_exchange_failed', {packageName: pending.packageName, error: msg});
        res.redirect(studioReturn(new URLSearchParams({ error: 'oauth_failed', message: msg })));
      }
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    });
  });

  // Load any previously-persisted secrets into process.env on startup,
  // then watch the file for changes — Studio writes to this file when
  // it completes an OAuth dance or saves a paste-field, so the runtime
  // needs to pick up new credentials without a restart.
  //
  // Path resolution: the admin agent is spawned with `cwd: <admin
  // agent dir>` but `REPO_PATH=<user's repo>` in env. We want to
  // watch the USER's secrets.env in both cases (main runtime and
  // admin agent), so prefer REPO_PATH when set. Falls back to
  // config.repoPath, which is the right path for the main runtime.
  {
    const secretsRepoPath = process.env['REPO_PATH'] ?? config.repoPath;
    const dir = path.join(secretsRepoPath, '.amodal');
    const file = path.join(dir, 'secrets.env');

    function loadSecrets(reason: 'startup' | 'change'): void {
      if (!existsSync(file)) return;
      let content: string;
      try {
        content = readFileSync(file, 'utf-8');
      } catch (err: unknown) {
        log.warn('secrets_read_failed', {file, error: err instanceof Error ? err.message : String(err)});
        return;
      }
      let count = 0;
      for (const line of content.split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1);
        if (k) { process.env[k] = v; count++; }
      }
      if (count > 0) {
        log.info(reason === 'startup' ? 'secrets_loaded_from_disk' : 'secrets_reloaded_from_disk', {count, file});
      }
    }

    loadSecrets('startup');

    // Watch the parent dir (not the file directly) so we still pick up
    // the first write — fs.watch on a non-existent file throws, and
    // editor-style "atomic save" replaces the inode which most
    // file-watchers miss when scoped to the path.
    if (existsSync(dir)) {
      try {
        const watcher = watch(dir, {persistent: false}, (_event, filename) => {
          if (filename === 'secrets.env') loadSecrets('change');
        });
        watcher.on('error', (err) => {
          log.warn('secrets_watcher_error', {file, error: err.message});
        });
      } catch (err: unknown) {
        log.warn('secrets_watch_failed', {dir, error: err instanceof Error ? err.message : String(err)});
      }
    }
  }

  // ---- Secrets write + per-connection detail -----------------------------

  app.use('/api/secrets', express.json({ limit: '64kb' }));
  app.post('/api/secrets/:name', (req, res) => {
    const name = req.params.name;
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      res.status(400).json({ error: 'Secret name must be uppercase with underscores (e.g. SLACK_BOT_TOKEN)' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
    const body = (req.body ?? {}) as Record<string, unknown>;
    const value = typeof body['value'] === 'string' ? body['value'].trim() : '';
    if (!value) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    // Set immediately so the current process sees it. The file is the
    // source of truth — ConfigWatcher re-reads on reload for persistence.
    process.env[name] = value;
    persistSecret(name, value);
    log.info('secret_saved', {name});
    res.json({ name, set: true });
  });

  /**
   * Per-package connection detail — what the studio's per-connection
   * configure page reads. Returns the full amodal block (auth, oauth)
   * plus per-envVar set/unset and oauth.available so the page can branch
   * its UI on auth type without re-deriving from the package list.
   */
  app.get('/api/connections/:packageName', (req, res) => {
    void (async () => {
      const packageName = decodeURIComponent(req.params.packageName);
      const bundleData = getBundle();
      for (const conn of bundleData.connections.values()) {
        const pkgDir = findPackageRoot(conn.location);
        if (!pkgDir) continue;
        const pkgJsonPath = path.join(pkgDir, 'package.json');
        if (!existsSync(pkgJsonPath)) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing trusted local JSON
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
            name?: string;
            amodal?: {
              displayName?: string;
              name?: string;
              description?: string;
              icon?: string;
              category?: string;
              auth?: {
                type?: string;
                envVars?: Record<string, string>;
                credentials?: Array<{ token?: string; envVar?: string; description?: string }>;
              };
              oauth?: { appKey: string; authorizeUrl: string; tokenUrl: string; scopes?: string[] };
            };
          };
          if (pkg.name !== packageName || !pkg.amodal) continue;
          const auth = pkg.amodal.auth ?? {};
          const envVarsRaw = auth.envVars ?? {};
          const envVars = Object.entries(envVarsRaw).map(([n, description]) => ({
            name: n,
            description,
            set: !!process.env[n],
          }));
          let oauth: { appKey: string; available: boolean; scopes?: string[]; reason?: 'no_credentials' } | undefined;
          if (pkg.amodal.oauth?.appKey) {
            const upper = pkg.amodal.oauth.appKey.toUpperCase().replace(/-/g, "_");
            const haveCreds = !!process.env[`${upper}_CLIENT_ID`] && !!process.env[`${upper}_CLIENT_SECRET`];
            oauth = haveCreds
              ? { appKey: pkg.amodal.oauth.appKey, available: true, scopes: pkg.amodal.oauth.scopes }
              : { appKey: pkg.amodal.oauth.appKey, available: false, scopes: pkg.amodal.oauth.scopes, reason: 'no_credentials' };
          }
          res.json({
            name: pkg.name,
            displayName: pkg.amodal.displayName ?? pkg.amodal.name ?? pkg.name,
            description: pkg.amodal.description ?? null,
            icon: pkg.amodal.icon ?? null,
            category: pkg.amodal.category ?? null,
            authType: auth.type ?? 'unknown',
            envVars,
            oauth: oauth ?? null,
          });
          return;
        } catch (err: unknown) {
          log.warn('malformed_package_json', {path: pkgJsonPath, error: err instanceof Error ? err.message : String(err)});
        }
      }
      res.status(404).json({ error: `Package '${packageName}' not found in installed connections` });
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    });
  });

  // ---- end OAuth broker --------------------------------------------------

  // Getting Started endpoint — returns per-package auth requirements
  // (displayName/description/icon/envVars) plus the template manifest if
  // the repo has a template.json. The studio's Getting Started tab
  // renders either the slot view (when template is present) or a flat
  // package list (when not).
  app.get('/api/getting-started', (_req, res) => {
    void (async () => {
      const bundleData = getBundle();
      const repoPath = config.repoPath;

      // Walk each loaded connection's `location` upward to find the
      // containing package.json, read its amodal block. Cache by package
      // name so multi-connection packages only get read once.
      type EnvVarStatus = { name: string; description: string; set: boolean };
      type OauthStatus = {
        appKey: string;
        available: boolean;
        /** Why OAuth isn't usable. Surfaced for UI hint copy. */
        reason?: 'no_metadata' | 'no_credentials';
      };
      const packageMap = new Map<string, {
        name: string;
        displayName: string;
        description?: string;
        icon?: string;
        envVars: EnvVarStatus[];
        oauth?: OauthStatus;
      }>();

      for (const conn of bundleData.connections.values()) {
        const pkgDir = findPackageRoot(conn.location);

        if (!pkgDir) {
          // Directory-based connection (connections/<name>/ in the repo).
          // Derive env var info from spec.json auth and baseUrl fields.
          if (packageMap.has(conn.name)) continue;
          const envVars: EnvVarStatus[] = [];
          const addEnvRef = (value: string | undefined, description: string) => {
            if (value?.startsWith('env:')) {
              const envName = value.slice(4);
              envVars.push({ name: envName, description, set: !!process.env[envName] });
            }
          };
          addEnvRef(conn.spec.baseUrl, 'Base URL');
          addEnvRef(conn.spec.auth?.token, 'Auth token');
          packageMap.set(conn.name, {
            name: conn.name,
            displayName: conn.name,
            envVars,
          });
          continue;
        }

        const pkgJsonPath = path.join(pkgDir, 'package.json');
        if (!existsSync(pkgJsonPath)) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing trusted local JSON
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
            name?: string;
            amodal?: {
              displayName?: string;
              name?: string;
              description?: string;
              icon?: string;
              auth?: { envVars?: Record<string, string> };
            };
          };
          if (!pkg.name || !pkg.amodal) continue;
          if (packageMap.has(pkg.name)) continue;
          const envVarsRaw = pkg.amodal.auth?.envVars ?? {};
          const envVars: EnvVarStatus[] = Object.entries(envVarsRaw).map(([name, description]) => ({
            name,
            description,
            set: !!process.env[name],
          }));
          // Project OAuth status if the package declares amodal.oauth.
          // OAuth is "available" when client credentials env vars are
          // present — the runtime broker can drive the flow.
          let oauth: OauthStatus | undefined;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing trusted local JSON
          const oauthMeta = (pkg.amodal as Record<string, unknown>)['oauth'] as
            | { appKey: string }
            | undefined;
          if (oauthMeta && typeof oauthMeta.appKey === 'string') {
            const upper = oauthMeta.appKey.toUpperCase().replace(/-/g, "_");
            const haveCreds = !!process.env[`${upper}_CLIENT_ID`] && !!process.env[`${upper}_CLIENT_SECRET`];
            oauth = haveCreds
              ? { appKey: oauthMeta.appKey, available: true }
              : { appKey: oauthMeta.appKey, available: false, reason: 'no_credentials' };
          }
          packageMap.set(pkg.name, {
            name: pkg.name,
            displayName: pkg.amodal.displayName ?? pkg.amodal.name ?? pkg.name,
            ...(pkg.amodal.description ? { description: pkg.amodal.description } : {}),
            ...(pkg.amodal.icon ? { icon: pkg.amodal.icon } : {}),
            envVars,
            ...(oauth ? { oauth } : {}),
          });
        } catch (err: unknown) {
          log.warn('malformed_package_json', {path: pkgJsonPath, error: err instanceof Error ? err.message : String(err)});
        }
      }

      // Package is "fulfilled" when every declared envVar is set in process.env.
      const packages = [...packageMap.values()].map((p) => ({
        ...p,
        isFulfilled: p.envVars.length > 0 && p.envVars.every((v) => v.set),
      }));

      // Read template.json from repo root if present.
      const templatePath = path.join(repoPath, 'template.json');
      let template: unknown = null;
      if (existsSync(templatePath)) {
        try {
          template = JSON.parse(readFileSync(templatePath, 'utf-8'));
        } catch (err: unknown) {
          log.warn('malformed_template_json', {path: templatePath, error: err instanceof Error ? err.message : String(err)});
        }
      }

      res.json({ template, packages });
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    });
  });

  // Unified config endpoint
  app.get('/api/config', (_req, res) => {
    const bundleData = getBundle();
    const cfg = bundleData.config;

    // Collect all env:* references from connection specs
    const envRefs: Array<{name: string; connection: string; set: boolean}> = [];
    for (const [connName, conn] of bundleData.connections) {
      const token = conn.spec.auth?.token;
      if (token && typeof token === 'string' && token.startsWith('env:')) {
        const envName = token.slice(4);
        envRefs.push({name: envName, connection: connName, set: !!process.env[envName]});
      }
    }

    res.json({
      appId,
      appName: cfg?.name ?? '',
      name: cfg?.name ?? '',
      version: cfg?.version ?? '',
      description: cfg?.description ?? '',
      models: cfg?.models ?? {},
      stores: cfg?.stores ? {...cfg.stores, activeBackend: storeBackendType} : null,
      repoPath: config.repoPath,
      envRefs,
      providerStatuses,
      nodeVersion: process.version,
      runtimeVersion: RUNTIME_VERSION,
      uptime: Math.floor(process.uptime()),
    });
  });

  // Resolve resume session ID
  let resumeSessionId = config.resumeSessionId;
  if (resumeSessionId === 'latest') {
    const {sessions: recent} = await sessionStore.list({
      limit: 1,
      filter: {appId},
    });
    resumeSessionId = recent[0]?.id;
  }
  if (resumeSessionId) {
    log.debug('resume_session', {sessionId: resumeSessionId});
  }

  // Client config — tells the web UI which session to resume
  app.get('/config', (_req, res) => {
    res.json({resumeSessionId: resumeSessionId ?? null});
  });

  // Session history routes (shared with hosted runtime via server.ts)
  app.use(createSessionsHistoryRouter({
    sessionStore,
    sessionManager,
    eventBus,
    appId,
  }));

  // File browser/editor — role-gated. Defaults to "everyone is ops" in
  // amodal dev; hosted-runtime injects a cloud RoleProvider.
  app.use(createFilesRouter({
    repoPath: config.repoPath,
    roleProvider: config.roleProvider,
  }));

  // Event bus SSE stream (live UI updates)
  app.use(createEventsRouter({bus: eventBus, logger: log}));

  // Feedback
  const feedbackStore = new FeedbackStore({agentId: appId});
  app.use(createFeedbackRouter({feedbackStore}));

  // Chat routes (new stack) — persistence is handled inside runMessage /
  // route-helpers, so no explicit hooks are needed here.
  app.use(createChatStreamRouter({
    sessionManager,
    bundleResolver,
    shared,
    summarizeToolResult: config.summarizeToolResult,
  }));
  app.use(createChatRouter({
    sessionManager,
    bundleResolver,
    shared,
    summarizeToolResult: config.summarizeToolResult,
  }));

  // Task runner
  app.use(createTaskRouter({sessionManager, createTaskSession: createTaskSessionComponents}));

  // Inspect
  app.use(createInspectRouter({getBundle, repoPath: config.repoPath}));

  // Package updates (npm view + cache)
  app.use(createPackageUpdatesRouter({repoPath: config.repoPath, logger: log}));

  // Messaging channels
  if (channelsResult) {
    app.use('/channels', channelsResult.router);
    log.info('channels_router_mounted', {channels: [...channelsResult.adapters.keys()]});
  }

  // Store REST API (if stores are defined)
  if (storeBackend) {
    app.use(createStoresRouter({repo: bundle, storeBackend, appId}));
  }

  // Eval runner
  app.use(createEvalRouter({
    getBundle,
    sessionManager,
    bundleResolver,
    shared,
  }));

  // Build user pages (if pages/ directory exists)
  let builtPages: BuiltPage[] = [];
  try {
    const result = await buildPages(config.repoPath);
    builtPages = result.pages;
    if (builtPages.length > 0) {
      log.info('pages_built', {count: builtPages.length});
      app.use('/pages-bundle', express.static(result.outDir));
    }
  } catch (err) {
    log.error('pages_build_failed', {error: err instanceof Error ? err.message : String(err)});
  }

  // Pages list endpoint
  app.get('/api/pages', (_req, res) => {
    res.json({
      pages: builtPages.map((p) => ({name: p.name, ...p.metadata})),
    });
  });

  // App middleware (e.g., Vite dev server for runtime app)
  if (config.appMiddleware) {
    app.use(config.appMiddleware as express.RequestHandler);
  } else if (config.staticAppDir && existsSync(config.staticAppDir)) {
    app.use(express.static(config.staticAppDir));
    app.use((_req, res, next) => {
      if (_req.path.startsWith('/api/') || _req.path.startsWith('/inspect/') || _req.path.startsWith('/sessions/') || _req.path === '/sessions' || _req.method !== 'GET') {
        next();
        return;
      }
      const indexPath = path.join(config.staticAppDir!, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }

  // Error handler (must be last)
  app.use(errorHandler);

  let server: http.Server | null = null;
  const host = config.host ?? '0.0.0.0';
  const port = config.port;

  return {
    app,

    async start(): Promise<http.Server> {
      // Start hot reload watcher
      if (config.hotReload) {
        watcher = new ConfigWatcher(config.repoPath, (newBundle) => {
          bundle = newBundle;
          // Shared resources and session components will pick up the new
          // bundle on next session creation via getBundle().
          log.info('config_reloaded', {name: newBundle.config.name});
          eventBus.emit({type: 'manifest_changed'});
          eventBus.emit({type: 'files_changed'});
        });
        watcher.start();
      }

      return new Promise((resolve) => {
        const httpServer = app.listen(port, host, () => {
          log.debug('server_started', {host, port, repoPath: config.repoPath, hotReload: !!config.hotReload});
          resolve(httpServer);
        });
        server = httpServer;
      });
    },

    async stop(): Promise<void> {
      if (watcher) {
        watcher.stop();
        watcher = null;
      }

      if (server) {
        const s = server;
        // Stop accepting new connections
        await new Promise<void>((resolve, reject) => {
          s.close((err) => {
            if (err) reject(err);
            else resolve();
          });
          // Force-close existing connections (SSE streams, etc.) so
          // close() doesn't hang waiting for them to drain.
          s.closeAllConnections();
        });
        server = null;
      }

      await sessionManager.shutdown();

      if (mcpManager) {
        await mcpManager.shutdown();
      }

      if (storeBackend) {
        await storeBackend.close();
      }

      await closeDb();

      log.info('server_stopped', {});
    },
  };
}

// ---------------------------------------------------------------------------
// /sessions + /session/:id response helpers
// ---------------------------------------------------------------------------

// Session history helpers (flattenModelMessage, extractFirstUserText, etc.)
// moved to routes/sessions-history.ts — shared between local-server and hosted runtime.
