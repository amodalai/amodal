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
import {ProactiveRunner} from './proactive/proactive-runner.js';
import {createChatStreamRouter} from '../routes/chat-stream.js';
import {createChatRouter} from '../routes/chat.js';
import {createAdminChatRouter} from './routes/admin-chat.js';
import {createTaskRouter} from './routes/task.js';
import {createInspectRouter} from './routes/inspect.js';
import {createFeedbackRouter} from './routes/feedback.js';
import {FeedbackStore} from './feedback-store.js';
import {createAutomationRouter} from './routes/automations.js';
import {createWebhookRouter} from './routes/webhooks.js';
import {createStoresRouter} from './routes/stores.js';
import {createFilesRouter} from './routes/files.js';
import {createEvalRouter} from './routes/evals.js';
import {errorHandler} from '../middleware/error-handler.js';
import {asyncHandler} from '../routes/route-helpers.js';
import type {LocalServerConfig} from './agent-types.js';
import type {ServerInstance} from '../server.js';
import {createPGLiteStoreBackend} from '../stores/pglite-store-backend.js';
import type {StoreBackend} from '@amodalai/types';
import {EvalStore} from './eval-store.js';
import {buildPages} from './page-builder.js';
import type {BuiltPage} from './page-builder.js';
import {LOCAL_APP_ID} from '../constants.js';
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
  // Store backend
  // -------------------------------------------------------------------------

  let storeBackend: StoreBackend | undefined;
  let storeBackendType = 'none';
  if (bundle.stores.length > 0) {
    const storeConfig = bundle.config.stores;
    const backend = storeConfig?.backend ?? 'pglite';

    if (backend === 'postgres' && storeConfig?.postgresUrl) {
      const connUrl = resolveEnvRef(storeConfig.postgresUrl) ?? '';
      if (!connUrl) {
        log.error('store_postgres_url_missing', {configured: storeConfig.postgresUrl});
      } else {
        try {
          const pgModPath = ['..', 'stores', 'postgres-store-backend.js'].join('/');
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import for optional postgres backend
          const mod = await import(pgModPath).catch(() => null) as {createPostgresStoreBackend?: (stores: typeof bundle.stores, url: string) => Promise<StoreBackend>} | null;
          if (mod?.createPostgresStoreBackend) {
            storeBackend = await mod.createPostgresStoreBackend(bundle.stores, connUrl);
            storeBackendType = 'postgres';
            log.info('store_backend_ready', {type: 'postgres', storeCount: bundle.stores.length});
          } else {
            log.error('store_postgres_unavailable', {hint: 'install @amodalai/store-postgres'});
          }
        } catch (err) {
          log.error('store_postgres_failed', {error: err instanceof Error ? err.message : String(err)});
          log.info('store_fallback_pglite', {});
        }
      }
    }

    // Default: PGLite
    if (!storeBackend) {
      const dataDir = storeConfig?.dataDir ?? `${config.repoPath}/.amodal/store-data`;

      // Check for lock file — another instance may be using this data dir.
      // Lock file lives in the PARENT dir (not inside dataDir) so it doesn't
      // conflict with PGLite's own PostgreSQL data files (e.g. postmaster.pid).
      const lockPath = `${dataDir}.lock`;
      try {
        const {readFileSync, writeFileSync, mkdirSync, unlinkSync} = await import('node:fs');
        const path = await import('node:path');
        mkdirSync(path.dirname(dataDir), {recursive: true});
        try {
          const existing = readFileSync(lockPath, 'utf-8').trim();
          try { process.kill(Number(existing), 0); log.warn('store_lock_conflict', {pid: existing}); }
          catch { /* PID not running — stale lock, safe to overwrite */ }
        } catch { /* No lock file exists — first run */ }
        writeFileSync(lockPath, String(process.pid));
        const lockCleanup = lockPath;
        process.on('exit', () => { try { unlinkSync(lockCleanup); } catch { /* exit handler — can't log */ } });
      } catch (err: unknown) {
        log.warn('store_lock_setup_failed', {dataDir, error: err instanceof Error ? err.message : String(err)});
      }

      try {
        storeBackend = await createPGLiteStoreBackend(bundle.stores, dataDir);
        storeBackendType = 'pglite';
        log.info('store_backend_ready', {type: 'pglite', storeCount: bundle.stores.length, dataDir});
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
        log.error('store_backend_init_failed', {error: errMsg, dataDir});
      }
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
  };

  // Helper: get current bundle (updated by config watcher)
  const getBundle = (): AgentBundle => bundle;

  // Helper: create automation session components
  const createAutomationSessionComponents = () => {
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
      appId: LOCAL_APP_ID,
    });
    return {session, toolContextFactory: components.toolContextFactory};
  };

  // -------------------------------------------------------------------------
  // Proactive runner
  // -------------------------------------------------------------------------

  const runner = new ProactiveRunner(bundle, {
    sessionManager,
    createSessionComponents: createAutomationSessionComponents,
    logger: log,
    webhookSecret: config.webhookSecret,
    summarizeToolResult: config.summarizeToolResult,
    onSessionComplete: (session, automationName) => {
      // Tag the automation name onto metadata so the UI can filter
      // sessions by automation via /sessions?automation=<name>.
      session.metadata.automationName = automationName;
      void sessionManager.persist(session);
    },
    eventBus,
    onAutomationResult: config.onAutomationResult,
  });

  // -------------------------------------------------------------------------
  // Channel plugins (messaging integrations)
  // -------------------------------------------------------------------------

  let channelsResult: {adapters: Map<string, ChannelAdapter>; router: import('express').Router} | null = null;

  if (bundle.channels && bundle.channels.length > 0) {
    // Both PGLite and Postgres factories return DrizzleSessionStore which
    // exposes `db` for sharing the connection pool with channel mappers.
    const {DrizzleSessionStore} = await import('../session/drizzle-session-store.js');
    if (!(sessionStore instanceof DrizzleSessionStore)) {
      throw new Error('Channels require a Drizzle-backed session store (pglite or postgres)');
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
        appId: LOCAL_APP_ID,
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
      appId: LOCAL_APP_ID,
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
      filter: {appId: LOCAL_APP_ID},
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

  // Sessions endpoints — served directly from the DrizzleSessionStore.
  //
  // Dev-UI consumers (sidebar Recent list, Sessions page, Automation detail
  // page) don't paginate — they render what they get and slice the top N.
  // A 500-session ceiling keeps the response bounded without forcing a
  // cursor API on the client today. If dev sessions regularly exceed this,
  // the store already supports cursor pagination via SessionListOptions.
  const SESSION_LIST_LIMIT = 500;
  app.get('/sessions', asyncHandler(async (req, res) => {
    const automationFilter = typeof req.query?.['automation'] === 'string' ? String(req.query['automation']) : undefined;
    // Automation filter uses metadata.automationName; otherwise restrict
    // to chat sessions by metadata.appId (excludes eval-runner / admin).
    const filter = automationFilter
      ? {automationName: automationFilter}
      : {appId: LOCAL_APP_ID};
    const {sessions: rows} = await sessionStore.list({limit: SESSION_LIST_LIMIT, filter});
    const sessions = rows.map((s) => {
      const title = typeof s.metadata['title'] === 'string' ? s.metadata['title'] : undefined;
      const appId = typeof s.metadata['appId'] === 'string' ? s.metadata['appId'] : LOCAL_APP_ID;
      const automationName = typeof s.metadata['automationName'] === 'string' ? s.metadata['automationName'] : undefined;
      return {
        id: s.id,
        appId,
        title,
        summary: title ?? extractFirstUserText(s.messages) ?? 'Untitled',
        createdAt: s.createdAt.getTime(),
        lastAccessedAt: s.updatedAt.getTime(),
        automationName,
      };
    });
    res.json({sessions});
  }));

  app.get('/session/:id', asyncHandler(async (req, res) => {
    const persisted = await sessionStore.load(req.params['id'] ?? '');
    if (!persisted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    const messages = persisted.messages.map(flattenModelMessage).filter((m) => m !== null);
    res.json({session_id: persisted.id, messages});
  }));

  app.patch('/session/:id', express.json(), asyncHandler(async (req, res) => {
    const sessionId = req.params['id'] ?? '';
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || !('title' in body) || typeof (body as Record<string, unknown>)['title'] !== 'string') {
      res.status(400).json({error: 'title (string) is required'});
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above
    const title = (body as Record<string, unknown>)['title'] as string;

    // Live session: mutate metadata on the shared object and persist so
    // the next /sessions read reflects the new title. A concurrent
    // runMessage may be mid-turn, but JSON.stringify runs atomically in
    // JS's single-threaded event loop — no torn writes. The next
    // end-of-turn persist will overwrite with the completed messages
    // array; metadata.title stays because it's on the live session.
    //
    // Not-live: load → mutate → save. No race possible.
    const live = sessionManager.get(sessionId);
    if (live) {
      live.metadata.title = title;
      await sessionManager.persist(live);
    } else {
      const persisted = await sessionStore.load(sessionId);
      if (!persisted) {
        res.status(404).json({error: 'Session not found'});
        return;
      }
      persisted.metadata.title = title;
      persisted.updatedAt = new Date();
      await sessionStore.save(persisted);
    }

    // Emit session_updated so the sidebar picks up the new title live.
    eventBus.emit({type: 'session_updated', sessionId, appId: LOCAL_APP_ID, title});
    res.json({ok: true});
  }));

  app.delete('/session/:id', asyncHandler(async (req, res) => {
    const sessionId = req.params['id'] ?? '';
    await sessionManager.destroy(sessionId);
    const deleted = await sessionStore.delete(sessionId);
    if (!deleted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    eventBus.emit({type: 'session_deleted', sessionId});
    res.json({ok: true});
  }));

  // File browser/editor — role-gated. Defaults to "everyone is ops" in
  // amodal dev; hosted-runtime injects a cloud RoleProvider.
  app.use(createFilesRouter({
    repoPath: config.repoPath,
    roleProvider: config.roleProvider,
  }));

  // Event bus SSE stream (live UI updates)
  app.use(createEventsRouter({bus: eventBus, logger: log}));

  // Evals
  const evalStore = new EvalStore(config.repoPath);
  app.use(createEvalRouter({getBundle, evalStore, repoPath: config.repoPath, getPort: () => config.port}));

  // Feedback
  const feedbackStore = new FeedbackStore(config.repoPath);
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
  app.use(createTaskRouter({sessionManager, createTaskSession: createAutomationSessionComponents}));

  // Admin chat (new stack)
  app.use(createAdminChatRouter({
    sessionManager,
    shared,
    getBundle,
    getPort: () => config.port,
  }));

  // Inspect
  app.use(createInspectRouter({getBundle, repoPath: config.repoPath}));

  // Automations
  app.use(createAutomationRouter({runner}));
  app.use(createWebhookRouter({runner, webhookSecret: config.webhookSecret}));

  // Messaging channels
  if (channelsResult) {
    app.use('/channels', channelsResult.router);
    log.info('channels_router_mounted', {channels: [...channelsResult.adapters.keys()]});
  }

  // Store REST API (if stores are defined)
  if (storeBackend) {
    app.use(createStoresRouter({repo: bundle, storeBackend, appId: LOCAL_APP_ID}));
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
      if (_req.path.startsWith('/api/') || _req.path.startsWith('/inspect/') || _req.method !== 'GET') {
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
      runner.stop();

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

      log.info('server_stopped', {});
    },
  };
}

// ---------------------------------------------------------------------------
// /sessions + /session/:id response helpers
// ---------------------------------------------------------------------------

/** Max length of the first-user-message excerpt shown in session lists. */
const SUMMARY_EXCERPT_MAX = 80;

/** Rendered history-message shape consumed by the dev-UI chat page. */
interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: Array<{
    toolId: string;
    toolName: string;
    parameters: Record<string, unknown>;
  }>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isTextPart(part: unknown): part is {type: 'text'; text: string} {
  return isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string';
}

function isToolCallPart(part: unknown): part is {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
} {
  return (
    isRecord(part) &&
    part['type'] === 'tool-call' &&
    typeof part['toolCallId'] === 'string' &&
    typeof part['toolName'] === 'string'
  );
}

function getMessageRole(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const role = raw['role'];
  return typeof role === 'string' ? role : null;
}

function getMessageContent(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;
  return raw['content'];
}

/** Truncate with an ellipsis when the source exceeds the excerpt budget. */
function excerpt(s: string): string {
  return s.length > SUMMARY_EXCERPT_MAX ? `${s.slice(0, SUMMARY_EXCERPT_MAX)}…` : s;
}

/** Extract the first user-message text from a persisted message array for list summaries. */
function extractFirstUserText(messages: readonly unknown[]): string | undefined {
  for (const raw of messages) {
    if (getMessageRole(raw) !== 'user') continue;
    const content = getMessageContent(raw);
    if (typeof content === 'string') return excerpt(content);
    if (Array.isArray(content)) {
      const firstText = content.find(isTextPart);
      if (firstText) return excerpt(firstText.text);
    }
  }
  return undefined;
}

/**
 * Flatten a persisted `ModelMessage` (ai SDK v6) into the shape the web UI's
 * /session/:id consumer expects: {role, text, toolCalls?}. Returns null for
 * tool-result messages and for assistant turns with no renderable content
 * (the history panel shows conversation + tool-call chips, not raw tool
 * plumbing).
 */
function flattenModelMessage(raw: unknown): HistoryMessage | null {
  const role = getMessageRole(raw);
  if (role !== 'user' && role !== 'assistant') return null;

  const content = getMessageContent(raw);
  if (typeof content === 'string') {
    return {role, text: content};
  }
  if (Array.isArray(content)) {
    const text = content.filter(isTextPart).map((p) => p.text).join('');
    const toolCalls = role === 'assistant'
      ? content.filter(isToolCallPart).map((p) => ({
        toolId: p.toolCallId,
        toolName: p.toolName,
        parameters: isRecord(p.input) ? p.input : {},
      }))
      : [];
    if (text.length === 0 && toolCalls.length === 0) return null;
    return toolCalls.length > 0 ? {role, text, toolCalls} : {role, text};
  }
  return null;
}


