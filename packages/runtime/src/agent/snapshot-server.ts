/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import express from 'express';
import type http from 'node:http';
import {loadSnapshotFromFile, snapshotToRepo} from '@amodalai/core';
import type {AmodalRepo, DeploySnapshot, CustomToolExecutor, CustomShellExecutor} from '@amodalai/core';
import {AgentSessionManager} from './session-manager.js';
import {LocalToolExecutor} from './tool-executor-local.js';
import {createChatRouter} from './routes/chat.js';
import {createTaskRouter} from './routes/task.js';
import {errorHandler} from '../middleware/error-handler.js';
import type {ServerInstance} from '../server.js';

/**
 * Config for creating a server from a local snapshot.
 *
 * Exactly one source must be provided:
 * - `snapshotPath` — load from a local JSON file
 * - `snapshot` — use a pre-loaded DeploySnapshot object
 * - `repo` — use a pre-loaded AmodalRepo
 */
export interface SnapshotServerConfig {
  /** Path to a resolved-config.json snapshot file. */
  snapshotPath?: string;
  /** A pre-loaded DeploySnapshot object. */
  snapshot?: DeploySnapshot;
  /** A pre-loaded AmodalRepo (e.g. from snapshotToRepo). */
  repo?: AmodalRepo;
  port: number;
  host?: string;
  sessionTtlMs?: number;
  corsOrigin?: string;
  /** Optional custom tool executor (e.g., Daytona sandbox executor) */
  toolExecutor?: CustomToolExecutor;
  /** Optional custom shell executor (e.g., Daytona sandbox executor) */
  shellExecutor?: CustomShellExecutor;
}

/**
 * Creates an Express server that runs from an immutable deploy snapshot.
 *
 * This is the local testing path: the CLI builds a snapshot and tests it
 * locally before deploying to the platform.
 */
export async function createSnapshotServer(config: SnapshotServerConfig): Promise<ServerInstance> {
  let repo: AmodalRepo;
  let deployId: string;

  if (config.repo) {
    repo = config.repo;
    deployId = repo.origin;
  } else if (config.snapshot) {
    repo = snapshotToRepo(config.snapshot, `snapshot:${config.snapshot.deployId}`);
    deployId = config.snapshot.deployId;
  } else if (config.snapshotPath) {
    const snapshot = await loadSnapshotFromFile(config.snapshotPath);
    repo = snapshotToRepo(snapshot, config.snapshotPath);
    deployId = snapshot.deployId;
  } else {
    throw new Error('One of snapshotPath, snapshot, or repo must be provided');
  }

  // Set up tool executor — use injected executor if provided, otherwise local
  let toolExecutor: CustomToolExecutor | undefined = config.toolExecutor;
  if (!toolExecutor && repo.tools.length > 0) {
    toolExecutor = new LocalToolExecutor();
  }

  const sessionManager = new AgentSessionManager(repo, {
    ttlMs: config.sessionTtlMs,
    toolExecutor,
    shellExecutor: config.shellExecutor,
  });

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
      mode: 'snapshot',
      deploy_id: deployId,
      agent_name: repo.config.name,
      connections: repo.connections.size,
      skills: repo.skills.length,
      uptime_ms: Date.now() - startedAt,
      active_sessions: sessionManager.size,
    });
  });

  // Routes
  app.use(createChatRouter({sessionManager}));
  app.use(createTaskRouter({sessionManager}));

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
          process.stderr.write(`[INFO] Snapshot server listening on ${host}:${port}\n`);
          process.stderr.write(`[INFO] Deploy: ${deployId}, Agent: ${repo.config.name}\n`);
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

      process.stderr.write('[INFO] Snapshot server stopped\n');
    },
  };
}
