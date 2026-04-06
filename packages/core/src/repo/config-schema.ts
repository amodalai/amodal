/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z, ZodError} from 'zod';

import {RepoError} from './repo-types.js';

/**
 * Resolves a single value that may use the `env:VAR_NAME` pattern.
 * Returns the environment variable value if the pattern matches,
 * or the original value otherwise.
 */
export function resolveEnvValue(value: string): string {
  if (!value.startsWith('env:')) {
    return value;
  }
  const varName = value.slice(4);
  if (!varName) {
    throw new RepoError('ENV_NOT_SET', 'Empty environment variable name in "env:" reference');
  }
  const envValue = process.env[varName];
  if (envValue === undefined) {
    throw new RepoError('ENV_NOT_SET', `Environment variable "${varName}" is not set`);
  }
  return envValue;
}

/**
 * Recursively resolves all `env:VAR_NAME` patterns in an object.
 */
export function resolveEnvValues(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvValue(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvValues(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveEnvValues(val);
    }
    return result;
  }
  return obj;
}

/**
 * Schema for a model configuration entry.
 */
export const ModelConfigSchema: z.ZodType<ModelConfig> = z.lazy(() =>
  z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    region: z.string().optional(),
    baseUrl: z.string().optional(),
    fallback: ModelConfigSchema.optional(),
    credentials: z.record(z.string()).optional(),
  }),
);

export interface ModelConfig {
  provider: string;
  model: string;
  region?: string;
  baseUrl?: string;
  fallback?: ModelConfig;
  /**
   * Explicit credentials for the provider.
   * When set, providers use these instead of reading from process.env.
   * This avoids shared mutable state (process.env) in multi-app hosted mode.
   */
  credentials?: Record<string, string>;
}

/**
 * Schema for amodal.json.
 */
export const AmodalConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  /** Custom base system prompt. When omitted, the platform default is used. */
  basePrompt: z.string().optional(),
  /** Subagent names to disable (e.g., ['explore', 'plan'] to turn off platform defaults) */
  disabledSubagents: z.array(z.string()).optional(),
  models: z.object({
    main: ModelConfigSchema,
    simple: ModelConfigSchema.optional(),
    advanced: ModelConfigSchema.optional(),
  }),
  proactive: z
    .object({
      webhook: z.string().min(1),
    })
    .optional(),
  platform: z
    .object({
      projectId: z.string().min(1),
      apiKey: z.string().min(1),
    })
    .optional(),
  sandbox: z
    .object({
      /** Enable shell_exec tool for LLM code execution */
      shellExec: z.boolean().default(false),
      /** Daytona workspace template ID for hosted mode */
      template: z.string().optional(),
      /** Maximum shell command execution timeout in ms */
      maxTimeout: z.number().int().positive().default(30000),
    })
    .optional(),
  stores: z
    .object({
      /** Directory for PGLite data (default: .amodal/store-data) */
      dataDir: z.string().optional(),
      /** Storage backend type */
      backend: z.enum(['pglite', 'postgres']).default('pglite'),
      /** PostgreSQL connection string (required when backend is 'postgres') */
      postgresUrl: z.string().optional(),
    })
    .optional(),
  webTools: z
    .object({
      /** Search/fetch provider. Only 'google' (Gemini grounding) is supported today. */
      provider: z.literal('google'),
      /** API key (supports env: refs, resolved by resolveEnvValues above). */
      apiKey: z.string().min(1),
      /** Gemini model to use for search + urlContext. Default: 'gemini-2.5-flash'. */
      model: z.string().min(1).optional(),
    })
    .optional(),
  /** Installed npm packages to load (content type detected from package structure) */
  packages: z.array(z.string()).optional(),
  mcp: z
    .object({
      /** MCP servers to connect to as a client */
      servers: z.record(z.string(), z.object({
        transport: z.enum(['stdio', 'sse', 'http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        url: z.string().optional(),
        headers: z.record(z.string()).optional(),
        trust: z.boolean().optional(),
      })),
    })
    .optional(),
});

export type AmodalConfig = z.infer<typeof AmodalConfigSchema>;

/**
 * Parse and validate a config JSON string. Resolves env: references.
 */
export function parseConfigJson(jsonString: string): AmodalConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new RepoError('CONFIG_PARSE_FAILED', 'Invalid JSON in config file', err);
  }

  let resolved: unknown;
  try {
    resolved = resolveEnvValues(raw);
  } catch (err) {
    if (err instanceof RepoError) {
      throw err;
    }
    throw new RepoError('CONFIG_PARSE_FAILED', 'Failed to resolve env values', err);
  }

  try {
    return AmodalConfigSchema.parse(resolved);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new RepoError(
        'CONFIG_VALIDATION_FAILED',
        `Config validation failed: ${issues}`,
        err,
      );
    }
    throw new RepoError('CONFIG_VALIDATION_FAILED', 'Config validation failed', err);
  }
}
