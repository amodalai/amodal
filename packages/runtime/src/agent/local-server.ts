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
import {createChatRouter} from './routes/chat.js';
import {createAdminChatRouter} from './routes/admin-chat.js';
import {createTaskRouter} from './routes/task.js';
import {createInspectRouter} from './routes/inspect.js';
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

/**
 * Creates an Express server for repo-based agent mode.
 *
 * Loads the `.amodal/` config from `config.repoPath`, creates a
 * `SessionManager`, mounts chat/task/inspect/automation/webhook routes,
 * and optionally watches for config changes (hot reload).
 */
export async function createLocalServer(config: LocalServerConfig): Promise<ServerInstance> {
  const repo = await loadRepo({localPath: config.repoPath});

  // Create shell executor if sandbox.shellExec is enabled
  const shellExecutor = repo.config.sandbox?.shellExec
    ? new LocalShellExecutor()
    : undefined;

  // Create shared store backend if stores are defined
  let storeBackend: StoreBackend | undefined;
  if (repo.stores.length > 0) {
    const dataDir = repo.config.stores?.dataDir
      ?? `${config.repoPath}/.amodal/store-data`;
    storeBackend = await createPGLiteStoreBackend(repo.stores, dataDir);
  }

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
    repo,
    shellExecutor,
    storeBackend,
  });

  // sessionStore is created later — use a lazy reference for the onSessionComplete callback
  let sessionStoreRef: SessionStore | null = null;

  const runner = new ProactiveRunner(repo, {
    webhookSecret: config.webhookSecret,
    createSession: async () => sessionManager.create('local'),
    destroySession: async (id) => sessionManager.destroy(id),
    onSessionComplete: (session, automationName) => {
      if (sessionStoreRef) {
        sessionStoreRef.save(session, automationName);
      }
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

  // Session persistence
  const sessionStore = new SessionStore(config.repoPath);
  sessionStoreRef = sessionStore;

  // Full agent config for the config page
  app.get('/api/config', (_req, res) => {
    const repoData = sessionManager.getRepo()!;
    const cfg = repoData.config;

    // Collect all env:* references from connection specs
    const envRefs: Array<{name: string; connection: string; set: boolean}> = [];
    for (const [connName, conn] of repoData.connections) {
      const token = conn.spec.auth?.token;
      if (token && typeof token === 'string' && token.startsWith('env:')) {
        const envName = token.slice(4);
        envRefs.push({name: envName, connection: connName, set: !!process.env[envName]});
      }
    }

    res.json({
      name: cfg?.name ?? '',
      version: cfg?.version ?? '',
      description: cfg?.description ?? '',
      models: cfg?.models ?? {},
      stores: cfg?.stores ?? null,
      repoPath: config.repoPath,
      envRefs,
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
    process.stderr.write(`[dev] Resume session: ${resumeSessionId}\n`);
  }

  // Client config — tells the web UI which session to resume
  app.get('/config', (_req, res) => {
    res.json({ resumeSessionId: resumeSessionId ?? null });
  });

  // Sessions endpoints
  app.get('/sessions', (req, res) => {
    const automationFilter = typeof req.query?.['automation'] === 'string' ? String(req.query['automation']) : undefined;
    const all = sessionStore.list();
    const filtered = automationFilter ? all.filter((s) => s.automationName === automationFilter) : all;
    res.json({sessions: filtered});
  });

  app.get('/session/:id', (req, res) => {
    const persisted = sessionStore.load(req.params['id'] ?? '');
    if (!persisted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    // Convert LLMMessage[] to the format the UI expects
    const isTextBlock = (b: unknown): b is {type: 'text'; text: string} =>
      typeof b === 'object' && b !== null && 'type' in b && 'text' in b &&
      (b as {type: unknown}).type === 'text' && typeof (b as {text: unknown}).text === 'string';
    const isToolUseBlock = (b: unknown): b is {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>} =>
      typeof b === 'object' && b !== null && 'type' in b &&
      (b as {type: unknown}).type === 'tool_use' && 'name' in b;

    const messages = persisted.conversationHistory.map((msg: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Persisted LLMMessage
      const m = msg as {role: string; content: unknown};
      if (m.role === 'user') {
        return {role: 'user', text: typeof m.content === 'string' ? m.content : ''};
      }
      if (m.role === 'assistant') {
        const blocks = Array.isArray(m.content) ? m.content : [];
        const text = blocks.filter(isTextBlock).map((b) => b.text).join('');
        const toolCalls = blocks.filter(isToolUseBlock).map((b) => ({
          toolId: b.id,
          toolName: b.name,
          parameters: b.input ?? {},
          status: 'success' as const,
        }));
        return {role: 'assistant', text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined};
      }
      return {role: m.role, text: ''};
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

  // Routes
  app.use(createChatRouter({
    sessionManager,
    sessionHydrator: async (_req, _res, sessionId, tenantId) => {
      const persisted = sessionStore.load(sessionId);
      if (!persisted) return null;

      // Create a fresh session and seed LLM history from stored conversation
      const session = await sessionManager.create(tenantId);
      sessionManager.reregister(session, sessionId);

      // Convert stored messages to history format and seed the LLM
      const { convertSessionMessagesToHistory } = await import('../session/history-converter.js');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Persisted data
      const history = convertSessionMessagesToHistory(persisted.conversationHistory as Array<import('../session/session-manager.js').SessionMessage>);
      if (history.length > 0) {
        session.geminiClient.setHistory(history);
      }

      process.stderr.write(`[SESSION] Restored session ${sessionId} (${persisted.conversationHistory.length} messages)\n`);
      return session;
    },
    onTurnComplete: (session) => {
      sessionStore.save(session);
    },
  }));
  app.use(createTaskRouter({sessionManager}));
  app.use(createAdminChatRouter({sessionManager}));
  app.use(createInspectRouter({sessionManager, repoPath: config.repoPath}));
  app.use(createAutomationRouter({runner}));
  app.use(createWebhookRouter({runner, webhookSecret: config.webhookSecret}));

  // Store REST API (if stores are defined)
  if (storeBackend) {
    app.use(createStoresRouter({repo, storeBackend, appId: 'local'}));
  }

  // Build user pages (if pages/ directory exists)
  let builtPages: Array<{name: string; outputPath: string}> = [];
  try {
    const result = await buildPages(config.repoPath);
    builtPages = result.pages;
    if (builtPages.length > 0) {
      process.stderr.write(`[dev] Built ${String(builtPages.length)} page(s)\n`);
      // Serve compiled page bundles
      app.use('/pages-bundle', express.static(result.outDir));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[dev] Page build failed: ${msg}\n`);
  }

  // Pages list endpoint
  app.get('/api/pages', (_req, res) => {
    res.json({
      pages: builtPages.map((p) => ({name: p.name})),
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
        watcher = new ConfigWatcher(config.repoPath, (newRepo) => {
          sessionManager.updateRepo(newRepo);
        });
        watcher.start();
      }

      return new Promise((resolve) => {
        const httpServer = app.listen(port, host, () => {
          process.stderr.write(`[INFO] Repo server listening on ${host}:${port}\n`);
          process.stderr.write(`[INFO] Repo: ${config.repoPath}\n`);
          if (config.hotReload) {
            process.stderr.write('[INFO] Hot reload enabled\n');
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

      process.stderr.write('[INFO] Repo server stopped\n');
    },
  };
}
