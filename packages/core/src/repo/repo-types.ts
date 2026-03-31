/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AmodalConfig} from './config-schema.js';
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
 * Error thrown during repo loading.
 */
export class RepoError extends Error {
  readonly code: RepoErrorCode;

  constructor(code: RepoErrorCode, message: string, cause?: unknown) {
    super(message, {cause});
    this.name = 'RepoError';
    this.code = code;
  }
}

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
  /** Cron schedule (e.g., "0 9 * * 1-5"). Omit for webhook or manual trigger. */
  schedule?: string;
  /** Trigger type: cron (scheduled), webhook (external POST), or manual (API/CLI). */
  trigger: 'cron' | 'webhook' | 'manual';
  /** The prompt sent to the agent when the automation fires. */
  prompt: string;
  location: string;
}

/**
 * A loaded agent (subagent) definition from agents/ directory.
 * Each subdirectory in agents/ defines a subagent. The reserved names
 * "explore" and "plan" override the default explore and plan agents.
 */
export interface LoadedAgent {
  /** Agent name (directory name, used for dispatch) */
  name: string;
  /** Display name for admin UI */
  displayName: string;
  /** Short description */
  description: string;
  /** Prompt template (from AGENT.md body) */
  prompt: string;
  /** Tools this agent can use */
  tools: string[];
  /** Max dispatch depth (1 = no sub-agents) */
  maxDepth: number;
  /** Max tool calls per execution */
  maxToolCalls: number;
  /** Timeout in seconds */
  timeout: number;
  /** Target output token range */
  targetOutputMin: number;
  targetOutputMax: number;
  /** Model tier: 'simple' for data gathering, 'advanced' for reasoning */
  modelTier?: 'default' | 'simple' | 'advanced';
  /** File path */
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
 * The fully loaded amodal repo — the complete runtime configuration.
 */
export interface AmodalRepo {
  /** Where the repo was loaded from */
  source: 'local' | 'platform';
  /** Absolute path (local) or platform API URL */
  origin: string;
  /** Parsed config */
  config: AmodalConfig;
  /** Loaded connections keyed by name */
  connections: Map<string, LoadedConnection>;
  /** Loaded skills */
  skills: LoadedSkill[];
  /** Agent overrides (simple, plan) and custom subagent definitions */
  agents: {main?: string; simple?: string; subagents: LoadedAgent[]};
  /** Loaded automations */
  automations: LoadedAutomation[];
  /** Knowledge documents */
  knowledge: LoadedKnowledge[];
  /** Eval definitions */
  evals: LoadedEval[];
  /** Custom tools from tools/ directory */
  tools: LoadedTool[];
  /** Store definitions from stores/ directory */
  stores: LoadedStore[];
  /** MCP servers to connect to */
  mcpServers?: Record<string, RepoMcpServerConfig>;
  /** Warnings from package resolution */
  warnings?: string[];
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
 * Options for loading an amodal repo.
 */
export interface RepoLoadOptions {
  /** Path to local amodal repo on disk */
  localPath?: string;
  /** Platform API URL for remote repo access */
  platformUrl?: string;
  /** Platform API key */
  platformApiKey?: string;
}
