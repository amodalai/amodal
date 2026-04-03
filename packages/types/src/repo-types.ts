/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AmodalConfig} from './config-types.js';
import type {LoadedConnection} from './connection-types.js';
import type {LoadedStore} from './store-types.js';
import type {LoadedTool} from './tool-types.js';

/**
 * Error codes for repo loading failures.
 */
export type RepoErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_PARSE_FAILED'
  | 'CONFIG_VALIDATION_FAILED'
  | 'ENV_NOT_SET'
  | 'READ_FAILED'
  | 'PLATFORM_FETCH_FAILED';

/**
 * A loaded skill definition.
 */
export interface LoadedSkill {
  name: string;
  description: string;
  trigger?: string;
  body: string;
  location: string;
}

/**
 * A loaded knowledge document.
 */
export interface LoadedKnowledge {
  name: string;
  title: string;
  body: string;
  location: string;
}

/**
 * A loaded automation definition.
 */
export interface LoadedAutomation {
  name: string;
  title: string;
  schedule?: string;
  trigger: 'cron' | 'webhook' | 'manual';
  prompt: string;
  location: string;
}

/**
 * A loaded agent (subagent) definition from agents/ directory.
 */
export interface LoadedAgent {
  name: string;
  displayName: string;
  description: string;
  prompt: string;
  tools: string[];
  maxDepth: number;
  maxToolCalls: number;
  timeout: number;
  targetOutputMin: number;
  targetOutputMax: number;
  modelTier?: 'default' | 'simple' | 'advanced';
  location: string;
}

/**
 * A loaded eval definition.
 */
export interface LoadedEval {
  name: string;
  title: string;
  description: string;
  setup: {app?: string; context?: string};
  query: string;
  assertions: Array<{text: string; negated: boolean}>;
  raw: string;
  location: string;
}

/**
 * MCP server configuration as stored in the repo.
 */
export interface RepoMcpServerConfig {
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  trust?: boolean;
}

/**
 * The fully loaded amodal repo — the complete runtime configuration.
 */
export interface AgentBundle {
  source: 'local' | 'platform';
  origin: string;
  config: AmodalConfig;
  connections: Map<string, LoadedConnection>;
  skills: LoadedSkill[];
  agents: {main?: string; simple?: string; subagents: LoadedAgent[]};
  automations: LoadedAutomation[];
  knowledge: LoadedKnowledge[];
  evals: LoadedEval[];
  tools: LoadedTool[];
  stores: LoadedStore[];
  mcpServers?: Record<string, RepoMcpServerConfig>;
  resolvedCredentials?: Record<string, string>;
  warnings?: string[];
}

/**
 * Options for loading an amodal repo.
 */
export interface RepoLoadOptions {
  localPath?: string;
  platformUrl?: string;
  platformApiKey?: string;
}
