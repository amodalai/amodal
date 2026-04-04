/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Amodal tool names
export {
  PROPOSE_KNOWLEDGE_TOOL_NAME,
  LOAD_KNOWLEDGE_TOOL_NAME,
  PRESENT_TOOL_NAME,
  REQUEST_TOOL_NAME,
  DISPATCH_TOOL_NAME,
} from './tools/amodal-tool-names.js';

// Amodal tool definitions
export {
  getProposeKnowledgeDefinition,
  getPresentToolDefinition,
  getRequestToolDefinition,
} from './tools/definitions/amodal-tools.js';

// Tool definition types
export type { ToolDefinition } from './tools/tool-definition-types.js';

// Knowledge base
export * from './knowledge/index.js';

// Widgets
export * from './widgets/index.js';

// Platform client and config
export * from './platform/index.js';

// Audit logging
export * from './audit/index.js';

// Version bundle system
export * from './versions/index.js';

// Template engine and connection types
export * from './templates/index.js';

// Role definitions and filtering
export * from './roles/index.js';

// Repo reader and configuration
export * from './repo/index.js';

// Store persistence
export * from './stores/index.js';

// Package management
export * from './packages/index.js';

// Security infrastructure
export * from './security/index.js';

// Runtime assembly
export * from './runtime/index.js';

// Snapshot builder and loader
export * from './snapshot/index.js';

// Eval infrastructure
export * from './eval/index.js';

// Runtime provider abstraction
export * from './providers/runtime/index.js';

// Default system prompt
export { buildDefaultPrompt } from './runtime/default-prompt.js';

// Logger
export { log, setLogLevel, getLogLevel, setLogFormat, getLogFormat, setSanitize, LogLevel, createLogger } from './logger.js';
export type { Logger, LoggerConfig, LogFormat } from './logger.js';

// MCP client manager
export * from './mcp/index.js';

// Admin agent
export * from './admin/index.js';
export * from './runtime/user-context.js';
