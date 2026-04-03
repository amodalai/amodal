/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { ConfigParameters } from '@amodalai/core';
import { createServer, type ServerInstance } from './server.js';
import { log } from './logger.js';

export const SERVER_VERSION = '0.1.0';

// Re-export for consumers
export { createServer } from './server.js';
export type { ServerInstance, CreateServerOptions } from './server.js';
export type { ServerConfig } from './types.js';
export { createAIStreamRouter, type AIStreamRouterOptions } from './routes/ai-stream.js';

// Local mode
export { createLocalServer } from './agent/local-server.js';
export type { LocalServerConfig, AgentChatRequest, AgentSession } from './agent/agent-types.js';
export { SessionManager } from './session/session-manager.js';
export type { ManagedSession, SessionManagerOptions, SessionStore, StoredSessionRecord } from './session/session-manager.js';
export { ProactiveRunner } from './agent/proactive/proactive-runner.js';
export type { AutomationInfo, ProactiveRunnerConfig } from './agent/proactive/proactive-runner.js';

// Snapshot mode
export { createSnapshotServer } from './agent/snapshot-server.js';
export type { SnapshotServerConfig } from './agent/snapshot-server.js';

// Route creators (used by hosted-runtime to build its own server)
export { createChatStreamRouter } from './routes/chat-stream.js';
export type { ChatStreamRouterOptions } from './routes/chat-stream.js';
export { createTaskRouter } from './agent/routes/task.js';
export type { TaskRouterOptions } from './agent/routes/task.js';

// Auth types (middleware implementation provided by hosting layer)
export { getAuthContext } from './middleware/auth.js';
export type { AuthContext } from './middleware/auth.js';

// Stream hooks & session runner
export type { StreamHooks } from './session/session-runner.js';
export { runMessage } from './session/session-runner.js';

// Output routing (for automation result delivery)
export { routeOutput } from './output/output-router.js';

// Error handler
export { errorHandler } from './middleware/error-handler.js';

// Typed error classes
export {
  AmodalError,
  ProviderError,
  RateLimitError,
  ProviderTimeoutError,
  ToolExecutionError,
  StoreError,
  ConnectionError,
  SessionError,
  CompactionError,
  ConfigError,
} from './errors.js';
export type { Result } from './errors.js';

// Logger
export { log, setLogLevel, getLogLevel, setLogFormat, getLogFormat, setSanitize, LogLevel, initLogLevel, interceptConsole, verbosityToLogLevel, createLogger } from './logger.js';
export type { Logger, LoggerConfig, LogFormat } from './logger.js';

// Config
export { loadConfig } from './config.js';
export type { AgentConfig, ConfigOverrides, LoadConfigOptions, McpServerConfig } from './config.js';


// ---------------------------------------------------------------------------
// Environment variable parsing
// ---------------------------------------------------------------------------

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Parse env vars
  const port = getEnvInt('PORT', 3000);
  const host = getEnvOrDefault('HOST', '0.0.0.0');
  const sessionTtlMs = getEnvInt('SESSION_TTL_MS', 30 * 60 * 1000);

  // LLM config comes from env. Default matches the platform API default.
  const model = getEnvOrDefault('MODEL', 'claude-sonnet-4-20250514');

  // WORKSPACE_DIR scopes file tools and shell_exec. In Docker, set to
  // /workspace so the agent cannot read server source code. When unset,
  // falls back to process.cwd() for local dev.
  const workspaceDir = process.env['WORKSPACE_DIR'] || process.cwd();

  // Base config params — minimal, org-agnostic defaults.
  // Org-specific config (tools, skills, knowledge, base_prompt, agent_context)
  // loaded per session using the API key from each request.
  const baseParams: Partial<ConfigParameters> = {
    sessionId: 'server-init',
    model,
    cwd: workspaceDir,
    targetDir: workspaceDir,
    debugMode: process.env['DEBUG'] === 'true',
    interactive: false,
    noBrowser: true,
  };

  // Create and start server
  let serverInstance: ServerInstance;
  try {
    const corsOrigin = process.env['CORS_ORIGIN'] || undefined;

    serverInstance = createServer({
      baseParams,
      config: {
        port,
        host,
        sessionTtlMs,
        automations: [],
        corsOrigin,
      },
      version: SERVER_VERSION,
    });

    await serverInstance.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.fatal(`Failed to start server: ${message}`);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal}, shutting down...`);
    try {
      await serverInstance.stop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Shutdown error: ${message}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Only run main when this file is the entry point (the runtime package itself)
const isMainModule =
  process.argv[1] &&
  (process.argv[1].includes('@amodalai/runtime') ||
    process.argv[1].includes('packages/runtime/'));

if (isMainModule) {
  main().catch((err) => {
    log.fatal(String(err));
    process.exit(1);
  });
}
