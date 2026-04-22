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
 *
 * Replaces the old initialization sequence that depended on gemini-cli-core's
 * Config, GeminiClient, and upstream ToolRegistry.
 */

import express from 'express';
import type http from 'node:http';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
import type {SharedResources} from '../routes/session-resolver.js';
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
import {createFeedbackRouter} from './routes/feedback.js';
import {FeedbackStore} from './feedback-store.js';
import {createStoresRouter} from './routes/stores.js';
import {createFilesRouter} from './routes/files.js';
import {createContextRouter} from './routes/context.js';
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
      log.info('provider_keys_verified', {providers: verified});
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
  log.info('database_schema_ready', {});

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
    log.info('legacy_appid_migrated', {from: 'local', to: appId});
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
        packages: bundle.config.packages,
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

  // Auth token endpoint — local dev returns empty (no auth needed)
  app.post('/auth/token', (_req, res) => {
    res.json({token: '', expires_at: null});
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

  // Sessions history routes are now mounted in server.ts via createSessionsHistoryRouter
  // when sessionStore is provided. No need to duplicate them here.

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
    bundleResolver: {staticBundle: bundle},
    shared,
    summarizeToolResult: config.summarizeToolResult,
  }));
  app.use(createChatRouter({
    sessionManager,
    bundleResolver: {staticBundle: bundle},
    shared,
    summarizeToolResult: config.summarizeToolResult,
  }));

  // Task runner
  app.use(createTaskRouter({sessionManager, createTaskSession: createTaskSessionComponents}));

  // Inspect
  app.use(createInspectRouter({getBundle, repoPath: config.repoPath}));

  // Messaging channels
  if (channelsResult) {
    app.use('/channels', channelsResult.router);
    log.info('channels_router_mounted', {channels: [...channelsResult.adapters.keys()]});
  }

  // Store REST API (if stores are defined)
  if (storeBackend) {
    app.use(createStoresRouter({repo: bundle, storeBackend, appId}));
  }

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
          log.info('server_started', {host, port, repoPath: config.repoPath, hotReload: !!config.hotReload});
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
