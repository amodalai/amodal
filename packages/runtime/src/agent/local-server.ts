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
import {AgentSessionManager} from './session-manager.js';
import {LocalShellExecutor} from './shell-executor-local.js';
import {ConfigWatcher} from './config-watcher.js';
import {ProactiveRunner} from './proactive/proactive-runner.js';
import {createChatRouter} from './routes/chat.js';
import {createTaskRouter} from './routes/task.js';
import {createInspectRouter} from './routes/inspect.js';
import {createAutomationRouter} from './routes/automations.js';
import {createWebhookRouter} from './routes/webhooks.js';
import {createStoresRouter} from './routes/stores.js';
import {errorHandler} from '../middleware/error-handler.js';
import type {LocalServerConfig} from './agent-types.js';
import type {ServerInstance} from '../server.js';
import {createPGLiteStoreBackend} from '../stores/pglite-store-backend.js';
import type {StoreBackend} from '@amodalai/core';

/**
 * Creates an Express server for repo-based agent mode.
 *
 * Loads the `.amodal/` config from `config.repoPath`, creates a
 * `AgentSessionManager`, mounts chat/task/inspect/automation/webhook routes,
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

  const sessionManager = new AgentSessionManager(repo, {
    ttlMs: config.sessionTtlMs,
    shellExecutor,
    storeBackend,
  });

  const runner = new ProactiveRunner(repo, {
    webhookSecret: config.webhookSecret,
    createSession: async () => sessionManager.create('automation'),
    destroySession: async (id) => sessionManager.destroy(id),
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

  // Routes
  app.use(createChatRouter({sessionManager}));
  app.use(createTaskRouter({sessionManager}));
  app.use(createInspectRouter({sessionManager, repoPath: config.repoPath}));
  app.use(createAutomationRouter({runner}));
  app.use(createWebhookRouter({runner, webhookSecret: config.webhookSecret}));

  // Store REST API (if stores are defined)
  if (storeBackend) {
    app.use(createStoresRouter({repo, storeBackend, tenantId: 'local'}));
  }

  // App middleware (e.g., Vite dev server for runtime app)
  if (config.appMiddleware) {
     
    app.use(config.appMiddleware as express.RequestHandler);
  } else if (config.staticAppDir && existsSync(config.staticAppDir)) {
    // Serve pre-built SPA static assets with index.html fallback
    app.use(express.static(config.staticAppDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(config.staticAppDir!, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({error: 'Runtime app not found'});
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
