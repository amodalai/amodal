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

import type {StoreBackend} from '@amodalai/types';
import {loadRepo, McpManager} from '@amodalai/core';
import {StandaloneSessionManager} from '../session/manager.js';
import {buildSessionComponents} from '../session/session-builder.js';
import type {SessionComponents} from '../session/session-builder.js';
import {LocalToolExecutor} from '../agent/tool-executor-local.js';
import {buildMcpConfigs} from '../agent/mcp-config.js';
import {createPGLiteStoreBackend} from '../stores/pglite-store-backend.js';
import {createLogger} from '../logger.js';
import {SessionError} from '../errors.js';
import type {Agent, AgentConfig, AgentSession} from './types.js';
import type {SSEEvent} from '../types.js';

const MCP_STARTUP_TIMEOUT_MS = 30_000;

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

  // MCP — with timeout to prevent hanging on broken MCP servers
  let mcpManager: McpManager | null = config.mcpManager ?? null;
  if (!mcpManager) {
    const mcpConfigs = buildMcpConfigs(bundle);
    if (Object.keys(mcpConfigs).length > 0) {
      const manager = new McpManager();
      try {
        await Promise.race([
          manager.startServers(mcpConfigs),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('MCP startup timed out')), MCP_STARTUP_TIMEOUT_MS);
          }),
        ]);
        if (manager.connectedCount > 0) {
          mcpManager = manager;
          logger.info('mcp_initialized', {servers: manager.connectedCount});
        }
      } catch (err) {
        logger.warn('mcp_startup_failed', {error: err instanceof Error ? err.message : String(err)});
        // Continue without MCP — agent still works for non-MCP tools
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
    throw new SessionError(`Session "${sessionId}" not found`, {
      sessionId,
      context: {operation: 'createAgentSession'},
    });
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
