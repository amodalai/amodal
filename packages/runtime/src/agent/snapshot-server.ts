/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Snapshot server (Phase 3.5e).
 *
 * Creates an Express server from an immutable deploy snapshot. Used for
 * local testing before deploying to the platform.
 */

import express from 'express';
import type http from 'node:http';
import {loadSnapshotFromFile, snapshotToBundle} from '@amodalai/core';
import type {AgentBundle, DeploySnapshot, CustomToolExecutor} from '@amodalai/types';
import {StandaloneSessionManager} from '../session/manager.js';
import {buildSessionComponents} from '../session/session-builder.js';
import {LocalToolExecutor} from './tool-executor-local.js';
import {createChatStreamRouter} from '../routes/chat-stream.js';
import {createTaskRouter} from './routes/task.js';
import {errorHandler} from '../middleware/error-handler.js';
import type {ServerInstance} from '../server.js';
import {ConfigError} from '../errors.js';
import {log, createLogger} from '../logger.js';

export interface SnapshotServerConfig {
  snapshotPath?: string;
  snapshot?: DeploySnapshot;
  bundle?: AgentBundle;
  port: number;
  host?: string;
  sessionTtlMs?: number;
  corsOrigin?: string;
  toolExecutor?: CustomToolExecutor;
}

export async function createSnapshotServer(config: SnapshotServerConfig): Promise<ServerInstance> {
  let bundle: AgentBundle;
  let deployId: string;

  if (config.bundle) {
    bundle = config.bundle;
    deployId = bundle.origin;
  } else if (config.snapshot) {
    bundle = snapshotToBundle(config.snapshot, `snapshot:${config.snapshot.deployId}`);
    deployId = config.snapshot.deployId;
  } else if (config.snapshotPath) {
    const snapshot = await loadSnapshotFromFile(config.snapshotPath);
    bundle = snapshotToBundle(snapshot, config.snapshotPath);
    deployId = snapshot.deployId;
  } else {
    throw new ConfigError('One of snapshotPath, snapshot, or bundle must be provided', {key: 'snapshotSource'});
  }

  let toolExecutor: CustomToolExecutor | undefined = config.toolExecutor;
  if (!toolExecutor && bundle.tools.length > 0) {
    toolExecutor = new LocalToolExecutor();
  }

  const sessionLogger = createLogger({component: 'snapshot-session'});
  const sessionManager = new StandaloneSessionManager({
    logger: sessionLogger,
    ttlMs: config.sessionTtlMs,
  });
  sessionManager.start();

  const shared = {
    storeBackend: null,
    mcpManager: null,
    logger: log,
    toolExecutor,
  };

  const createTaskSession = () => {
    const components = buildSessionComponents({
      bundle,
      storeBackend: null,
      mcpManager: null,
      logger: log,
      toolExecutor,
    });
    const session = sessionManager.create({
      tenantId: 'snapshot',
      userId: 'snapshot',
      provider: components.provider,
      toolRegistry: components.toolRegistry,
      permissionChecker: components.permissionChecker,
      systemPrompt: components.systemPrompt,
      userRoles: components.userRoles,
      toolContextFactory: components.toolContextFactory,
    });
    return {session, toolContextFactory: components.toolContextFactory};
  };

  const app = express();

  // CORS
  const corsOrigin = config.corsOrigin ?? '*';
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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
      mode: 'snapshot',
      deploy_id: deployId,
      agent_name: bundle.config.name,
      connections: bundle.connections.size,
      skills: bundle.skills.length,
      uptime_ms: Date.now() - startedAt,
      active_sessions: sessionManager.size,
    });
  });

  // Routes
  app.use(createChatStreamRouter({
    sessionManager,
    bundleResolver: {staticBundle: bundle},
    shared,
  }));
  app.use(createTaskRouter({sessionManager, createTaskSession}));

  // Error handler (must be last)
  app.use(errorHandler);

  let server: http.Server | null = null;
  const host = config.host ?? '0.0.0.0';
  const port = config.port;

  return {
    app,

    async start(): Promise<http.Server> {
      return new Promise((resolve) => {
        const httpServer = app.listen(port, host, () => {
          log.info('snapshot_server_started', {host, port, deployId, agent: bundle.config.name});
          resolve(httpServer);
        });
        server = httpServer;
      });
    },

    async stop(): Promise<void> {
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
      log.info('snapshot_server_stopped', {});
    },
  };
}
