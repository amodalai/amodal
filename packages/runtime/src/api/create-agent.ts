/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Public API entry point for programmatic agent usage.
 *
 * ```typescript
 * import { createAgent } from '@amodalai/runtime';
 *
 * const agent = await createAgent({ repoPath: './my-agent' });
 * const session = agent.createSession();
 *
 * for await (const event of session.stream('Hello!')) {
 *   if (event.type === 'text_delta') process.stdout.write(event.content);
 * }
 *
 * await agent.shutdown();
 * ```
 */

import type {AgentBundle, StoreBackend} from '@amodalai/types';
import {loadRepo, McpManager} from '@amodalai/core';
import {StandaloneSessionManager} from '../session/manager.js';
import {buildSessionComponents} from '../session/session-builder.js';
import type {SessionComponents} from '../session/session-builder.js';
import {LocalToolExecutor} from '../agent/tool-executor-local.js';
import {createPGLiteStoreBackend} from '../stores/pglite-store-backend.js';
import {createLogger} from '../logger.js';
import {LOCAL_APP_ID} from '../constants.js';
import type {Agent, AgentConfig, AgentSession} from './types.js';
import type {SSEEvent} from '../types.js';

// ---------------------------------------------------------------------------
// MCP initialization (copied from local-server.ts — shared logic)
// ---------------------------------------------------------------------------

function buildMcpConfigs(
  bundle: AgentBundle,
): Record<string, {transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; trust?: boolean}> {
  const configs: Record<string, {transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; trust?: boolean}> = {};

  for (const [name, conn] of bundle.connections) {
    if (conn.spec.protocol === 'mcp') {
      const resolveEnv = (obj: Record<string, string>): Record<string, string> => {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = value.startsWith('env:') ? (process.env[value.slice(4)] ?? '') : value;
        }
        return result;
      };

      configs[name] = {
        transport: conn.spec.transport ?? 'stdio',
        command: conn.spec.command,
        args: conn.spec.args,
        env: conn.spec.env ? resolveEnv(conn.spec.env) : undefined,
        url: conn.spec.url,
        headers: conn.spec.headers ? resolveEnv(conn.spec.headers) : undefined,
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

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

/**
 * Create a running agent from a repo path or pre-loaded bundle.
 *
 * This is the main entry point for programmatic use of the Amodal runtime.
 * It loads the agent configuration, initializes stores, MCP connections,
 * and the session manager, then returns an Agent handle for creating
 * sessions and streaming messages.
 */
export async function createAgent(config: AgentConfig): Promise<Agent> {
  const logger = config.logger ?? createLogger({component: 'agent'});

  // Load bundle
  const bundle = config.bundle ?? await loadRepo({localPath: config.repoPath});

  // Store backend
  let storeBackend: StoreBackend | null = config.storeBackend ?? null;
  if (!storeBackend && bundle.stores.length > 0 && config.repoPath) {
    const dataDir = `${config.repoPath}/.amodal/store-data`;
    storeBackend = await createPGLiteStoreBackend(bundle.stores, dataDir);
  }

  // Tool executor
  const toolExecutor = bundle.tools.length > 0 ? new LocalToolExecutor() : undefined;

  // MCP
  let mcpManager: McpManager | null = config.mcpManager ?? null;
  if (!mcpManager) {
    const mcpConfigs = buildMcpConfigs(bundle);
    if (Object.keys(mcpConfigs).length > 0) {
      const manager = new McpManager();
      await manager.startServers(mcpConfigs);
      if (manager.connectedCount > 0) {
        mcpManager = manager;
      }
    }
  }

  // Session manager
  const sessionManager = new StandaloneSessionManager({
    logger,
    ttlMs: config.sessionTtlMs,
  });
  sessionManager.start();

  // Build components once (reused for each session)
  const components = buildSessionComponents({
    bundle,
    storeBackend,
    mcpManager,
    logger,
    toolExecutor,
  });

  return {
    createSession(opts) {
      const session = sessionManager.create({
        tenantId: opts?.tenantId ?? LOCAL_APP_ID,
        userId: opts?.userId ?? 'api',
        provider: components.provider,
        toolRegistry: components.toolRegistry,
        permissionChecker: components.permissionChecker,
        systemPrompt: components.systemPrompt,
        userRoles: opts?.userRoles ?? components.userRoles,
        toolContextFactory: components.toolContextFactory,
      });

      return createAgentSession(sessionManager, session.id, components);
    },

    async resumeSession(sessionId) {
      const existing = sessionManager.get(sessionId);
      if (existing) {
        return createAgentSession(sessionManager, existing.id, components);
      }
      return null;
    },

    getSystemPrompt() {
      return components.systemPrompt;
    },

    getBundle() {
      return bundle;
    },

    async shutdown() {
      await sessionManager.shutdown();
      if (mcpManager) {
        await mcpManager.shutdown();
      }
      if (storeBackend) {
        await storeBackend.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// AgentSession wrapper
// ---------------------------------------------------------------------------

function createAgentSession(
  sessionManager: StandaloneSessionManager,
  sessionId: string,
  components: SessionComponents,
): AgentSession {
  const session = sessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session "${sessionId}" not found`);
  }

  return {
    get id() { return sessionId; },
    get session() { return session; },

    async *stream(message: string, opts?: {signal?: AbortSignal}): AsyncGenerator<SSEEvent> {
      yield* sessionManager.runMessage(sessionId, message, {
        signal: opts?.signal,
        buildToolContext: components.toolContextFactory,
      });
    },
  };
}
