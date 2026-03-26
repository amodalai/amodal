/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Re-export ALL upstream symbols so consumers only need @amodalai/core
export * from '@google/gemini-cli-core';

// Our config wrapper
export {
  AmodalConfig,
  type AmodalConfigParameters,
  type AmodalConfigExtensions,
} from './amodal-config.js';
export type { ToolContext } from './tool-context.js';

// Tool registration
export { registerAmodalTools } from './tool-registration.js';

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

// Multi-provider content generator (bridges upstream ContentGenerator to RuntimeProvider)
export * from './providers/content-generator/index.js';

// Default system prompt
export { buildDefaultPrompt } from './runtime/default-prompt.js';

// Store tools
export { StoreWriteTool } from './tools/store-write-tool.js';
export { StoreQueryTool, QUERY_STORE_TOOL_NAME } from './tools/store-query-tool.js';

// Custom tool types
export * from './tools/http-tool-types.js';
export * from './tools/chain-tool-types.js';
export * from './tools/function-tool-types.js';
export * from './tools/request-tool-types.js';

// Custom tool registrars
export { registerHttpTools } from './tools/http-tool-registry.js';
export { registerChainTools } from './tools/chain-tool-registry.js';
export { registerFunctionTools } from './tools/function-tool-registry.js';

// Request tool
export { RequestTool } from './tools/request-tool.js';

// MCP client manager
export * from './mcp/index.js';

// AgentSDK
export { AgentSDK } from './sdk.js';
