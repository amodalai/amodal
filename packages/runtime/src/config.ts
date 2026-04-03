/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Unified runtime configuration.
 *
 * Consolidates amodal.json, environment variables, and runtime overrides
 * into a single typed, validated config object. Replaces the split between
 * core's AmodalConfig schema and the upstream gemini-cli-core Config wrapper.
 *
 * Config precedence (highest to lowest):
 * 1. Runtime overrides (passed to createAgent() by ISVs)
 * 2. Environment variables
 * 3. amodal.json in the agent repo
 * 4. Sensible defaults
 *
 * @example
 * ```ts
 * import { loadConfig } from './config.js';
 *
 * const config = loadConfig({
 *   repoPath: '/path/to/agent',
 *   overrides: { logLevel: 'debug' },
 * });
 * ```
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelConfig , AmodalConfigSchema } from '@amodalai/core';
import { parseConfigJson } from '@amodalai/core';
import type { z } from 'zod';

/** The raw amodal.json shape (Zod-inferred, NOT the AmodalConfig class wrapper) */
type RepoConfig = z.infer<typeof AmodalConfigSchema>;
import { ConfigError } from './errors.js';
import { LogLevel } from './logger.js';

// Re-export ModelConfig for convenience
export type { ModelConfig } from '@amodalai/core';

/** Parse log level from string — duplicated here to avoid circular dep with logger.ts */
function parseLogLevelStr(value: string | undefined): LogLevel {
  switch (value?.toLowerCase()) {
    case 'trace': return LogLevel.TRACE;
    case 'debug': return LogLevel.DEBUG;
    case 'info': return LogLevel.INFO;
    case 'warn': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    case 'fatal': return LogLevel.FATAL;
    case 'none': return LogLevel.NONE;
    case undefined: return LogLevel.INFO;
    default: return LogLevel.INFO;
  }
}

/**
 * Known provider API key environment variable names.
 */
const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  bedrock: 'AWS_ACCESS_KEY_ID', // Bedrock uses AWS credential chain
};

// ---------------------------------------------------------------------------
// AgentConfig — the unified config type
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** Agent name from amodal.json */
  readonly name: string;
  /** Agent version */
  readonly version: string;
  /** Agent description */
  readonly description?: string;
  /** Standing instructions for the LLM (userContext from amodal.json) */
  readonly userContext?: string;
  /** Custom base system prompt (overrides default) */
  readonly basePrompt?: string;
  /** Subagent names to disable */
  readonly disabledSubagents: string[];

  /** Primary model configuration */
  readonly primaryModel: ModelConfig;
  /** Secondary model for simple tasks (optional) */
  readonly simpleModel?: ModelConfig;
  /** Advanced model for complex reasoning (optional) */
  readonly advancedModel?: ModelConfig;
  /** All models keyed by role name */
  readonly models: Record<string, ModelConfig>;

  /** Store backend configuration */
  readonly stores: {
    readonly backend: 'pglite' | 'postgres';
    readonly dataDir: string;
    readonly postgresUrl?: string;
  };

  /** MCP server configurations */
  readonly mcpServers: Record<string, McpServerConfig>;

  /** Sandbox/shell execution settings */
  readonly sandbox: {
    readonly shellExec: boolean;
    readonly maxTimeout: number;
    readonly template?: string;
  };

  /** Platform integration (optional) */
  readonly platform?: {
    readonly projectId: string;
    readonly apiKey: string;
  };

  /** Webhook secret for proactive automations */
  readonly webhookSecret?: string;

  /** Log level */
  readonly logLevel: LogLevel;

  /** Repo path (absolute) */
  readonly repoPath: string;

  /** Raw amodal.json (for consumers that need fields not in this interface) */
  readonly raw: RepoConfig;
}

export interface McpServerConfig {
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  trust?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime overrides — what ISVs can pass to createAgent()
// ---------------------------------------------------------------------------

export interface ConfigOverrides {
  /** Override log level */
  logLevel?: LogLevel;
  /** Override primary model */
  primaryModel?: Partial<ModelConfig>;
  /** Override store backend */
  storeBackend?: 'pglite' | 'postgres';
  /** Override store data directory */
  storeDataDir?: string;
  /** Override postgres URL */
  postgresUrl?: string;
}

// ---------------------------------------------------------------------------
// loadConfig()
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /** Path to the agent repo root (must contain .amodal/ or amodal.json) */
  repoPath: string;
  /** Runtime overrides from createAgent() */
  overrides?: ConfigOverrides;
}

/**
 * Load, validate, and return the unified agent config.
 *
 * Reads amodal.json from the repo, resolves env: references,
 * applies environment variable overrides, applies runtime overrides,
 * and validates the result. Throws ConfigError with actionable
 * messages on any failure.
 */
export function loadConfig(opts: LoadConfigOptions): AgentConfig {
  const { repoPath, overrides } = opts;

  // 1. Find and read amodal.json
  const configPath = findConfigFile(repoPath);
  if (!configPath) {
    throw new ConfigError(
      'amodal.json',
      'Config file not found',
      `Create an amodal.json in ${repoPath} or run 'amodal init' to scaffold a new agent.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    throw new ConfigError(
      'amodal.json',
      `Cannot read config file: ${configPath}`,
      'Check file permissions.',
    );
  }

  // 2. Parse and validate (core's parseConfigJson handles Zod + env: resolution)
  let repoConfig: RepoConfig;
  try {
    repoConfig = parseConfigJson(raw);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not set')) {
      // Extract the env var name from the error message
      const match = err.message.match(/"(\w+)" is not set/);
      const varName = match?.[1] ?? 'UNKNOWN';
      throw new ConfigError(
        `env:${varName}`,
        `Environment variable "${varName}" is not set`,
        `Set ${varName} in your .env file or environment. This is referenced in amodal.json.`,
      );
    }
    throw new ConfigError(
      'amodal.json',
      err instanceof Error ? err.message : String(err),
      'Check your amodal.json for syntax errors or invalid values.',
    );
  }

  // 3. Validate provider API key is available
  validateProviderKey(repoConfig.models.main);

  // 4. Build the unified config
  const storeDataDir = overrides?.storeDataDir
    ?? repoConfig.stores?.dataDir
    ?? join(repoPath, '.amodal', 'store-data');

  const storeBackend = overrides?.storeBackend ?? repoConfig.stores?.backend ?? 'pglite';

  let postgresUrl = overrides?.postgresUrl ?? repoConfig.stores?.postgresUrl;
  if (postgresUrl && postgresUrl.startsWith('env:')) {
    const envVar = postgresUrl.slice(4);
    postgresUrl = process.env[envVar];
    if (!postgresUrl && storeBackend === 'postgres') {
      throw new ConfigError(
        'stores.postgresUrl',
        `Postgres URL environment variable "${envVar}" is not set`,
        `Set ${envVar} in your .env file. Required when stores.backend is 'postgres'.`,
      );
    }
  }

  const logLevel = overrides?.logLevel
    ?? parseLogLevelStr(process.env['LOG_LEVEL'])
    ?? LogLevel.INFO;

  const mcpServers: Record<string, McpServerConfig> = {};
  if (repoConfig.mcp?.servers) {
    for (const [name, server] of Object.entries(repoConfig.mcp.servers)) {
      mcpServers[name] = server;
    }
  }

  const config: AgentConfig = {
    name: repoConfig.name,
    version: repoConfig.version,
    description: repoConfig.description,
    userContext: repoConfig.userContext,
    basePrompt: repoConfig.basePrompt,
    disabledSubagents: repoConfig.disabledSubagents ?? [],

    primaryModel: applyModelOverrides(repoConfig.models.main, overrides?.primaryModel),
    simpleModel: repoConfig.models.simple,
    advancedModel: repoConfig.models.advanced,
    models: {
      main: applyModelOverrides(repoConfig.models.main, overrides?.primaryModel),
      ...(repoConfig.models.simple && { simple: repoConfig.models.simple }),
      ...(repoConfig.models.advanced && { advanced: repoConfig.models.advanced }),
    },

    stores: {
      backend: storeBackend,
      dataDir: storeDataDir,
      postgresUrl,
    },

    mcpServers,

    sandbox: {
      shellExec: repoConfig.sandbox?.shellExec ?? false,
      maxTimeout: repoConfig.sandbox?.maxTimeout ?? 30000,
      template: repoConfig.sandbox?.template,
    },

    platform: repoConfig.platform,
    webhookSecret: repoConfig.proactive?.webhook,
    logLevel,
    repoPath,
    raw: repoConfig,
  };

  return config;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findConfigFile(repoPath: string): string | undefined {
  // Check both locations: root amodal.json and .amodal/config.json
  const candidates = [
    join(repoPath, 'amodal.json'),
    join(repoPath, '.amodal', 'config.json'),
  ];
  return candidates.find((p) => existsSync(p));
}

function validateProviderKey(model: ModelConfig): void {
  // If explicit credentials are provided, skip env var check
  if (model.credentials && Object.keys(model.credentials).length > 0) {
    return;
  }

  const provider = model.provider;
  const envKey = PROVIDER_ENV_KEYS[provider];

  if (!envKey) {
    // Unknown provider — if they have a baseUrl, it's OpenAI-compatible and needs OPENAI_API_KEY
    if (model.baseUrl) {
      const key = model.credentials?.['OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY'];
      if (!key) {
        throw new ConfigError(
          'models.main.credentials',
          `OpenAI-compatible provider "${provider}" requires an API key`,
          `Set OPENAI_API_KEY in your environment or add credentials.OPENAI_API_KEY to the model config.`,
        );
      }
    }
    return;
  }

  const key = process.env[envKey];
  if (!key) {
    throw new ConfigError(
      `models.main.provider (${provider})`,
      `Provider API key not found`,
      `Set ${envKey} in your .env file or environment.\n  Checked: amodal.json → models.main.credentials\n  Checked: env → ${envKey}`,
    );
  }
}

function applyModelOverrides(
  base: ModelConfig,
  overrides?: Partial<ModelConfig>,
): ModelConfig {
  if (!overrides) return base;
  return { ...base, ...overrides };
}
