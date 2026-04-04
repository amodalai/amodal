/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Local server for repo-based agent mode (Phase 3.5e).
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
import {existsSync} from 'node:fs';
import path from 'node:path';
import {loadRepo} from '@amodalai/core';
import type {AgentBundle} from '@amodalai/types';
import {StandaloneSessionManager} from '../session/manager.js';
import {PGLiteSessionStore} from '../session/store.js';
import {buildSessionComponents} from '../session/session-builder.js';
import type {SharedResources} from '../routes/session-resolver.js';
import {LocalToolExecutor} from './tool-executor-local.js';
import {ConfigWatcher} from './config-watcher.js';
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
import type {LocalServerConfig} from './agent-types.js';
import type {ServerInstance} from '../server.js';
import {createPGLiteStoreBackend} from '../stores/pglite-store-backend.js';
import type {StoreBackend} from '@amodalai/types';
import {SessionStore} from './session-store.js';
import {EvalStore} from './eval-store.js';
import {buildPages} from './page-builder.js';
import type {BuiltPage} from './page-builder.js';
import {LOCAL_APP_ID} from '../constants.js';
import {log, createLogger} from '../logger.js';

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

const PROVIDER_CHECKS = [
  {provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY', url: 'https://api.anthropic.com/v1/messages', authHeader: (key: string) => ({'x-api-key': key, 'anthropic-version': '2023-06-01'})},
  {provider: 'openai', envVar: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/models', authHeader: (key: string) => ({Authorization: `Bearer ${key}`})},
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
export async function createLocalServer(config: LocalServerConfig): Promise<ServerInstance> {
  let bundle = await loadRepo({localPath: config.repoPath});

  // Check provider API keys in the background at startup
  let providerStatuses: ProviderStatus[] = PROVIDER_CHECKS.map((c) => ({
    provider: c.provider, envVar: c.envVar, keySet: !!process.env[c.envVar], verified: false,
  }));
  checkProviders().then((results) => {
    providerStatuses = results;
    const verified = results.filter((r) => r.verified).map((r) => r.provider);
    if (verified.length > 0) {
      log.info('provider_keys_verified', {providers: verified});
    }
    const failed = results.filter((r) => r.keySet && !r.verified);
    for (const f of failed) {
      log.warn('provider_key_invalid', {provider: f.provider, error: f.error});
    }
  }).catch(() => {});

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
      const connUrl = storeConfig.postgresUrl.startsWith('env:')
        ? process.env[storeConfig.postgresUrl.slice(4)] ?? ''
        : storeConfig.postgresUrl;
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

      // Check for lock file — another instance may be using this data dir
      const lockPath = `${dataDir}/server.lock`;
      try {
        const {readFileSync, writeFileSync, mkdirSync, unlinkSync} = await import('node:fs');
        mkdirSync(dataDir, {recursive: true});
        try {
          const existing = readFileSync(lockPath, 'utf-8').trim();
          try { process.kill(Number(existing), 0); log.warn('store_lock_conflict', {pid: existing}); }
          catch { /* PID not running, stale lock */ }
        } catch { /* no lock file */ }
        writeFileSync(lockPath, String(process.pid));
        const lockCleanup = lockPath;
        process.on('exit', () => { try { unlinkSync(lockCleanup); } catch { /* */ } });
      } catch { /* lock file handling failed, proceed anyway */ }

      try {
        storeBackend = await createPGLiteStoreBackend(bundle.stores, dataDir);
        storeBackendType = 'pglite';
        log.info('store_backend_ready', {type: 'pglite', storeCount: bundle.stores.length, dataDir});
      } catch (err) {
        log.error('store_backend_init_failed', {error: err instanceof Error ? err.message : String(err), dataDir});
      }
    }
  }

  // -------------------------------------------------------------------------
  // Session manager (new standalone stack)
  // -------------------------------------------------------------------------

  const sessionLogger = createLogger({component: 'session-manager'});
  const sessionStore = new PGLiteSessionStore({logger: sessionLogger});
  await sessionStore.initialize();

  const sessionManager = new StandaloneSessionManager({
    logger: sessionLogger,
    store: sessionStore,
    ttlMs: config.sessionTtlMs,
  });
  sessionManager.start();

  // Legacy session store for UI history (file-based)
  const legacySessionStore = new SessionStore(config.repoPath);

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
      tenantId: 'local',
      userId: 'automation',
      provider: components.provider,
      toolRegistry: components.toolRegistry,
      permissionChecker: components.permissionChecker,
      systemPrompt: components.systemPrompt,
      userRoles: components.userRoles,
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
    onSessionComplete: (session) => {
      void sessionManager.persist(session);
    },
  });

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
      runtimeVersion: '0.1.10',
      uptime: Math.floor(process.uptime()),
    });
  });

  // Resolve resume session ID
  let resumeSessionId = config.resumeSessionId;
  if (resumeSessionId === 'latest') {
    resumeSessionId = legacySessionStore.latest() ?? undefined;
  }
  if (resumeSessionId) {
    log.debug('resume_session', {sessionId: resumeSessionId});
  }

  // Client config — tells the web UI which session to resume
  app.get('/config', (_req, res) => {
    res.json({resumeSessionId: resumeSessionId ?? null});
  });

  // Sessions endpoints (legacy file-based store for UI history)
  app.get('/sessions', (req, res) => {
    const automationFilter = typeof req.query?.['automation'] === 'string' ? String(req.query['automation']) : undefined;
    const all = legacySessionStore.list();
    const visible = all.filter((s) => s.appId !== 'eval-runner' && s.appId !== 'admin');
    const filtered = automationFilter ? visible.filter((s) => s.automationName === automationFilter) : visible;
    res.json({sessions: filtered});
  });

  app.get('/session/:id', (req, res) => {
    const persisted = legacySessionStore.load(req.params['id'] ?? '');
    if (!persisted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    const messages = persisted.conversationHistory.map((msg: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Persisted message
      const m = msg as Record<string, unknown>;

      if (m['type'] === 'user') {
        return {role: 'user', text: String(m['text'] ?? '')};
      }
      if (m['type'] === 'assistant_text') {
        return {role: 'assistant', text: String(m['text'] ?? ''), toolCalls: m['toolCalls']};
      }
      if (m['role'] === 'user') {
        return {role: 'user', text: typeof m['content'] === 'string' ? m['content'] : ''};
      }
      if (m['role'] === 'assistant') {
        const blocks = Array.isArray(m['content']) ? m['content'] : [];
        const isTextBlock = (b: unknown): b is {text: string} =>
          typeof b === 'object' && b !== null && 'type' in b && (b as Record<string, unknown>)['type'] === 'text' && 'text' in b;
        const text = blocks.filter(isTextBlock).map((b) => b.text).join('');
        return {role: 'assistant', text};
      }

      return {role: String(m['role'] ?? m['type'] ?? 'unknown'), text: String(m['text'] ?? '')};
    });
    res.json({session_id: persisted.id, messages});
  });

  app.patch('/session/:id', express.json(), (req, res) => {
    const sessionId = req.params['id'] ?? '';
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || !('title' in body) || typeof (body as Record<string, unknown>)['title'] !== 'string') {
      res.status(400).json({error: 'title (string) is required'});
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above
    const title = (body as Record<string, unknown>)['title'] as string;
    const updated = legacySessionStore.updateTitle(sessionId, title);
    if (!updated) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    res.json({ok: true});
  });

  app.delete('/session/:id', (req, res) => {
    const sessionId = req.params['id'] ?? '';
    void sessionManager.destroy(sessionId);
    const deleted = legacySessionStore.delete(sessionId);
    if (!deleted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    res.json({ok: true});
  });

  // File browser/editor
  app.use(createFilesRouter({repoPath: config.repoPath}));

  // Evals
  const evalStore = new EvalStore(config.repoPath);
  app.use(createEvalRouter({getBundle, evalStore, repoPath: config.repoPath, getPort: () => config.port}));

  // Feedback
  const feedbackStore = new FeedbackStore(config.repoPath);
  app.use(createFeedbackRouter({feedbackStore}));

  // Chat routes (new stack)
  app.use(createChatStreamRouter({
    sessionManager,
    bundleResolver: {staticBundle: bundle},
    shared,
    createStreamHooks: () => ({
      onSessionPersist: (sessionId) => {
        const session = sessionManager.get(sessionId);
        if (session) {
          void sessionManager.persist(session);
        }
      },
    }),
  }));
  app.use(createChatRouter({
    sessionManager,
    bundleResolver: {staticBundle: bundle},
    shared,
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
        await new Promise<void>((resolve, reject) => {
          s.close((err) => {
            if (err) reject(err);
            else resolve();
          });
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
// MCP config builder
// ---------------------------------------------------------------------------

function resolveEnvRefs(obj: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value.startsWith('env:')) {
      result[key] = process.env[value.slice(4)] ?? '';
    } else {
      result[key] = value;
    }
  }
  return result;
}

function buildMcpConfigs(
  bundle: AgentBundle,
): Record<string, {transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; trust?: boolean}> {
  const configs: Record<string, {transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; trust?: boolean}> = {};

  for (const [name, conn] of bundle.connections) {
    if (conn.spec.protocol === 'mcp') {
      configs[name] = {
        transport: conn.spec.transport ?? 'stdio',
        command: conn.spec.command,
        args: conn.spec.args,
        env: conn.spec.env ? resolveEnvRefs(conn.spec.env) : undefined,
        url: conn.spec.url,
        headers: conn.spec.headers ? resolveEnvRefs(conn.spec.headers) : undefined,
        trust: conn.spec.trust,
      };
    }
  }

  if (bundle.mcpServers) {
    for (const [name, config] of Object.entries(bundle.mcpServers)) {
      if (!configs[name]) {
        configs[name] = config;
      }
    }
  }

  return configs;
}
