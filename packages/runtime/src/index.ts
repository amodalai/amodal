/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

 

import { createServer, type ServerInstance } from './server.js';
import { log } from './logger.js';

export const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { createAgent } from './api/create-agent.js';
export type { Agent, AgentConfig, AgentSession } from './api/types.js';

// ---------------------------------------------------------------------------
// Re-export for consumers
// ---------------------------------------------------------------------------
export { createServer } from './server.js';
export type { ServerInstance, CreateServerOptions } from './server.js';
export type { ServerConfig } from './types.js';
export { createAIStreamRouter, type AIStreamRouterOptions } from './routes/ai-stream.js';

// RoleProvider — auth/RBAC abstraction for hosting layers
export {
  defaultRoleProvider,
  requireRole,
  hasRole,
  RoleProviderError,
} from './role-provider.js';
export type {
  RoleProvider,
  RuntimeRole,
  RuntimeUser,
} from './role-provider.js';

// Preview tokens — HMAC-signed grants for preview snapshot access
export {
  signPreviewToken,
  verifyPreviewToken,
  PreviewTokenSecretMissingError,
} from './preview/token.js';
export type {
  PreviewTokenPayload,
  SignPreviewTokenOptions,
  VerifyPreviewTokenOptions,
  VerifyPreviewTokenResult,
  VerifyPreviewTokenFailureReason,
} from './preview/token.js';

// Local mode
export { createLocalServer } from './agent/local-server.js';
export type { LocalServerConfig, AgentChatRequest } from './agent/agent-types.js';
export { ProactiveRunner } from './agent/proactive/proactive-runner.js';
export type { AutomationInfo, ProactiveRunnerConfig } from './agent/proactive/proactive-runner.js';

// Snapshot mode
export { createSnapshotServer } from './agent/snapshot-server.js';
export type { SnapshotServerConfig } from './agent/snapshot-server.js';

// Route creators (used by hosted-runtime to build its own server)
export { createChatStreamRouter } from './routes/chat-stream.js';
export type { ChatStreamRouterOptions } from './routes/chat-stream.js';
export { createChatRouter } from './routes/chat.js';
export type { ChatRouterOptions } from './routes/chat.js';
export { createTaskRouter } from './agent/routes/task.js';
export type { TaskRouterOptions } from './agent/routes/task.js';

// Auth types (middleware implementation provided by hosting layer)
export { getAuthContext } from './middleware/auth.js';
export type { AuthContext } from './middleware/auth.js';

// Stream hooks
export type { StreamHooks, TokenCounts } from './session/stream-hooks.js';

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
export type { AgentConfig as LegacyAgentConfig, ConfigOverrides, LoadConfigOptions, McpServerConfig } from './config.js';

// LLM Provider (Vercel AI SDK abstraction)
export { createProvider } from './providers/create-provider.js';
export { createFailoverProvider } from './providers/failover.js';
export type { FailoverChainConfig } from './providers/failover.js';
export type {
  LLMProvider,
  ProviderConfig,
  StreamTextOptions,
  StreamTextResult,
  GenerateTextOptions,
  GenerateTextResult,
  TokenUsage,
  StreamEvent,
} from './providers/types.js';

// Agent loop (state machine)
export { runAgent, transition } from './agent/loop.js';
export type {
  AgentState,
  AgentContext,
  AgentLoopConfig,
  TransitionResult,
  RunAgentOptions,
  ToolCall,
  ToolResult,
  DoneReason,
  ThinkingState,
  StreamingState,
  ExecutingState,
  ConfirmingState,
  CompactingState,
  DispatchingState,
  DoneState,
  DispatchConfig,
} from './agent/loop-types.js';
export { DEFAULT_LOOP_CONFIG } from './agent/loop-types.js';

// Tool registry
export { createToolRegistry } from './tools/registry.js';
export type {
  ToolDefinition,
  ToolContext,
  ToolCategory,
  ToolMetadata,
  ToolRegistry,
} from './tools/types.js';

// MCP tool adapter
export {
  createMcpToolDefinition,
  registerMcpTools,
} from './tools/mcp-tool-adapter.js';

// Store tools (new Zod-based implementations)
export {
  createStoreWriteTool,
  createStoreBatchTool,
  createStoreQueryTool,
  registerStoreTools,
  storeToToolName,
  QUERY_STORE_TOOL_NAME,
} from './tools/store-tools.js';

// Connection request tool
export { createRequestTool, REQUEST_TOOL_NAME } from './tools/request-tool.js';
export type { ConnectionsMap, CreateRequestToolOptions } from './tools/request-tool.js';

// Admin file tools
export {
  createReadRepoFileTool,
  createWriteRepoFileTool,
  createDeleteRepoFileTool,
  createInternalApiTool,
  registerAdminFileTools,
} from './tools/admin-file-tools.js';

// Standalone session manager
export { StandaloneSessionManager } from './session/manager.js';
export type {
  Session,
  CreateSessionOptions,
  SessionManagerOptions as StandaloneSessionManagerOptions,
  TurnUsage,
  AutomationResult,
  PersistedSession,
} from './session/types.js';

// Session builder
export { buildSessionComponents, PRESENT_TOOL_NAME, STOP_EXECUTION_TOOL_NAME } from './session/session-builder.js';
export type { SessionComponents, BuildSessionComponentsOptions, SessionType } from './session/session-builder.js';

// Tool context factory
export { createToolContextFactory } from './session/tool-context-factory.js';
export type { ToolContextFactoryOptions } from './session/tool-context-factory.js';

// Session resolver
export { resolveSession, resolveBundle } from './routes/session-resolver.js';
export type { BundleResolver, SharedResources, ResolvedSession, ResolveSessionOptions } from './routes/session-resolver.js';

// Context compiler
export { compileContext } from './context/compiler.js';
export type {
  CompilerInput,
  CompilerOutput,
  CompilerContribution,
  CompilerConnection,
  CompilerSkill,
  CompilerKnowledge,
  CompilerStore,
} from './context/types.js';

// Messaging channels
export { loadChannelPlugins } from './channels/plugin-loader.js';
export type { LoadChannelPluginsOptions } from './channels/plugin-loader.js';
export { createChannelsRouter } from './channels/routes.js';
export type { ChannelsRouterOptions } from './channels/routes.js';
export { DrizzleChannelSessionMapper } from './channels/channel-session-mapper.js';
export type { ChannelSessionMapperOptions, CreateChannelSession } from './channels/channel-session-mapper.js';
export { InMemoryChannelSessionMapper } from './channels/in-memory-session-mapper.js';
export type { InMemoryChannelSessionMapperOptions } from './channels/in-memory-session-mapper.js';
export { bootstrapChannels } from './channels/bootstrap.js';
export type { BootstrapChannelsOptions, BootstrapChannelsResult } from './channels/bootstrap.js';
export { MessageDedupCache } from './channels/dedup-cache.js';
export { ChannelPluginError, ChannelConfigError } from './channels/errors.js';
export { RuntimeEventBus } from './events/event-bus.js';

// Permission checker
export { AccessJsonPermissionChecker } from './security/permission-checker.js';
export type {
  PermissionChecker,
  PermissionResult,
  PermissionCheckRequest,
} from './security/permission-checker.js';

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

  // Create and start server
  let serverInstance: ServerInstance;
  try {
    const corsOrigin = process.env['CORS_ORIGIN'] || undefined;

    serverInstance = createServer({
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
