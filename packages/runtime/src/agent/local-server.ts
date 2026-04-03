/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import express from 'express';
import type http from 'node:http';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {loadRepo} from '@amodalai/core';
import {SessionManager} from '../session/session-manager.js';
import {LocalShellExecutor} from './shell-executor-local.js';
import {ConfigWatcher} from './config-watcher.js';
import {ProactiveRunner} from './proactive/proactive-runner.js';
import {createChatStreamRouter} from '../routes/chat-stream.js';
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
import type {StoreBackend} from '@amodalai/core';
import {SessionStore} from './session-store.js';
import {EvalStore} from './eval-store.js';
import {buildPages} from './page-builder.js';
import type {BuiltPage} from './page-builder.js';
import {LOCAL_APP_ID} from '../constants.js';
import {log} from '../logger.js';

interface ProviderStatus {
  provider: string;
  envVar: string;
  keySet: boolean;
  verified: boolean;
  error?: string;
}

const PROVIDER_CHECKS: Array<{provider: string; envVar: string; url: string; authHeader: (key: string) => Record<string, string>}> = [
  {provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY', url: 'https://api.anthropic.com/v1/models', authHeader: (k) => ({'x-api-key': k, 'anthropic-version': '2023-06-01'})},
  {provider: 'openai', envVar: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/models?limit=1', authHeader: (k) => ({Authorization: `Bearer ${k}`})},
  {provider: 'google', envVar: 'GOOGLE_API_KEY', url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', authHeader: (k) => ({'x-goog-api-key': k})},
  {provider: 'deepseek', envVar: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/v1/models', authHeader: (k) => ({Authorization: `Bearer ${k}`})},
  {provider: 'groq', envVar: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/models', authHeader: (k) => ({Authorization: `Bearer ${k}`})},
  {provider: 'mistral', envVar: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/models', authHeader: (k) => ({Authorization: `Bearer ${k}`})},
  {provider: 'xai', envVar: 'XAI_API_KEY', url: 'https://api.x.ai/v1/models', authHeader: (k) => ({Authorization: `Bearer ${k}`})},
];

async function checkProviders(): Promise<ProviderStatus[]> {
  const results = await Promise.allSettled(
    PROVIDER_CHECKS.map(async (check) => {
      const key = process.env[check.envVar];
      if (!key) {
        return {provider: check.provider, envVar: check.envVar, keySet: false, verified: false};
      }
      try {
        // globalThis.fetch is available in Node 18+
        const res: {ok: boolean; status: number} = await globalThis.fetch(check.url, {
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

/**
 * Creates an Express server for repo-based agent mode.
 *
 * Loads the `.amodal/` config from `config.repoPath`, creates a
 * `SessionManager`, mounts chat/task/inspect/automation/webhook routes,
 * and optionally watches for config changes (hot reload).
 */
export async function createLocalServer(config: LocalServerConfig): Promise<ServerInstance> {
  const repo = await loadRepo({localPath: config.repoPath});

  // Check provider API keys in the background at startup
  let providerStatuses: ProviderStatus[] = PROVIDER_CHECKS.map((c) => ({
    provider: c.provider, envVar: c.envVar, keySet: !!process.env[c.envVar], verified: false,
  }));
  checkProviders().then((results) => {
    providerStatuses = results;
    const verified = results.filter((r) => r.verified).map((r) => r.provider);
    if (verified.length > 0) {
      process.stderr.write(`[dev] Provider keys verified: ${verified.join(', ')}\n`);
    }
    const failed = results.filter((r) => r.keySet && !r.verified);
    for (const f of failed) {
      process.stderr.write(`[dev] Provider key invalid: ${f.provider} (${f.error ?? 'unknown'})\n`);
    }
  }).catch(() => {});

  // Create shell executor if sandbox.shellExec is enabled
  const shellExecutor = repo.config.sandbox?.shellExec
    ? new LocalShellExecutor()
    : undefined;

  // Create shared store backend if stores are defined
  let storeBackend: StoreBackend | undefined;
  if (repo.stores.length > 0) {
    const dataDir = repo.config.stores?.dataDir
      ?? `${config.repoPath}/.amodal/store-data`;
    try {
      storeBackend = await createPGLiteStoreBackend(repo.stores, dataDir);
      log.info(`Store backend ready (${String(repo.stores.length)} stores, dir: ${dataDir})`, 'dev');
    } catch (err) {
      log.error(`Store backend failed to initialize: ${err instanceof Error ? err.message : String(err)}`, 'dev');
      log.error(`Try deleting ${dataDir} and restarting`, 'dev');
    }
  }

  // Session persistence — created before SessionManager so hydration works
  const sessionStore = new SessionStore(config.repoPath);

  const sessionManager = new SessionManager({
    baseParams: {
      sessionId: 'local-init',
      interactive: false,
      noBrowser: true,
      debugMode: process.env['DEBUG'] === 'true',
      cwd: config.repoPath,
      targetDir: config.repoPath,
    },
    ttlMs: config.sessionTtlMs,
    bundle: repo,
    shellExecutor,
    storeBackend,
    sessionStore: {
      async getSession(sessionId: string) {
        const persisted = sessionStore.load(sessionId);
        if (!persisted || !persisted.conversationHistory.length) return null;
        return {
          id: persisted.id,
          app_id: persisted.appId,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Persisted data
          messages: persisted.conversationHistory as Array<import('../session/session-manager.js').SessionMessage>,
          status: 'completed',
        };
      },
    },
  });

  const runner = new ProactiveRunner(repo, {
    webhookSecret: config.webhookSecret,
    createSession: async () => sessionManager.create(LOCAL_APP_ID),
    destroySession: async (id) => sessionManager.destroy(id),
    onSessionComplete: (session, automationName) => {
      sessionStore.save(session, automationName);
    },
  });

  let watcher: ConfigWatcher | null = null;

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
    res.json({ token: '', expires_at: null });
  });

  // Unified config endpoint — same path as hosted, different response
  app.get('/api/config', (_req, res) => {
    const bundleData = sessionManager.getBundle()!;
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
      // Common fields (used by useHostedConfig)
      appId: LOCAL_APP_ID,
      appName: cfg?.name ?? '',
      // No authMode — signals to the SPA that no auth is needed
      // Local dev fields (used by config pages)
      name: cfg?.name ?? '',
      version: cfg?.version ?? '',
      description: cfg?.description ?? '',
      models: cfg?.models ?? {},
      stores: cfg?.stores ?? null,
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
    resumeSessionId = sessionStore.latest() ?? undefined;
  }
  if (resumeSessionId) {
    log.debug(`Resume session: ${resumeSessionId}`, 'dev');
  }

  // Client config — tells the web UI which session to resume
  app.get('/config', (_req, res) => {
    res.json({ resumeSessionId: resumeSessionId ?? null });
  });

  // Sessions endpoints
  app.get('/sessions', (req, res) => {
    const automationFilter = typeof req.query?.['automation'] === 'string' ? String(req.query['automation']) : undefined;
    const all = sessionStore.list();
    // Filter out eval and admin sessions from chat history
    const visible = all.filter((s) => s.appId !== 'eval-runner' && s.appId !== 'admin');
    const filtered = automationFilter ? visible.filter((s) => s.automationName === automationFilter) : visible;
    res.json({sessions: filtered});
  });

  app.get('/session/:id', (req, res) => {
    const persisted = sessionStore.load(req.params['id'] ?? '');
    if (!persisted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    // Convert persisted messages to the format the UI expects.
    // Supports both SessionMessage format ({type, text}) and legacy LLMMessage ({role, content}).
    const messages = persisted.conversationHistory.map((msg: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Persisted message
      const m = msg as Record<string, unknown>;

      // SessionMessage format (new): {type: 'user'|'assistant_text'|'error', text, toolCalls?, ...}
      if (m['type'] === 'user') {
        return {role: 'user', text: String(m['text'] ?? '')};
      }
      if (m['type'] === 'assistant_text') {
        return {role: 'assistant', text: String(m['text'] ?? ''), toolCalls: m['toolCalls']};
      }

      // Legacy LLMMessage format: {role: 'user'|'assistant', content: string|Block[]}
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
    const updated = sessionStore.updateTitle(sessionId, title);
    if (!updated) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    // Also update in-memory session if active
    const activeSession = sessionManager.get(sessionId);
    if (activeSession) {
      activeSession.title = title;
    }
    res.json({ok: true});
  });

  app.delete('/session/:id', (req, res) => {
    const sessionId = req.params['id'] ?? '';
    // Destroy in-memory session if active
    void sessionManager.destroy(sessionId);
    const deleted = sessionStore.delete(sessionId);
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
  app.use(createEvalRouter({sessionManager, evalStore, repoPath: config.repoPath, getPort: () => config.port}));

  // Feedback
  const feedbackStore = new FeedbackStore(config.repoPath);
  app.use(createFeedbackRouter({feedbackStore}));

  // Routes
  app.use(createChatStreamRouter({
    sessionManager,
    createStreamHooks: () => ({
      onSessionPersist: (sessionId) => {
        const session = sessionManager.get(sessionId);
        if (session) sessionStore.save(session);
      },
    }),
  }));
  app.use(createTaskRouter({sessionManager}));
  app.use(createAdminChatRouter({sessionManager, getPort: () => config.port}));
  app.use(createInspectRouter({sessionManager, repoPath: config.repoPath}));
  app.use(createAutomationRouter({runner}));
  app.use(createWebhookRouter({runner, webhookSecret: config.webhookSecret}));

  // Store REST API (if stores are defined)
  if (storeBackend) {
    app.use(createStoresRouter({repo, storeBackend, appId: LOCAL_APP_ID}));
  }

  // Build user pages (if pages/ directory exists)
  let builtPages: BuiltPage[] = [];
  try {
    const result = await buildPages(config.repoPath);
    builtPages = result.pages;
    if (builtPages.length > 0) {
      log.info(`Built ${String(builtPages.length)} page(s)`, 'dev');
      // Serve compiled page bundles
      app.use('/pages-bundle', express.static(result.outDir));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Page build failed: ${msg}`, 'dev');
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
    // Serve pre-built SPA static assets with index.html fallback
    app.use(express.static(config.staticAppDir));
    // SPA fallback — serve index.html for any non-API, non-static route
    app.use((_req, res, next) => {
      // Don't intercept API or inspect routes (already handled above)
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
          sessionManager.updateBundle(newBundle);
        });
        watcher.start();
      }

      return new Promise((resolve) => {
        const httpServer = app.listen(port, host, () => {
          log.info(`Repo server listening on ${host}:${port}`);
          log.info(`Repo: ${config.repoPath}`);
          if (config.hotReload) {
            log.info('Hot reload enabled');
          }
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

      if (storeBackend) {
        await storeBackend.close();
      }

      log.info('Repo server stopped');
    },
  };
}
