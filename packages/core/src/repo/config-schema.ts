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

export const EmbedConfigSchema = z.object({
  enabled: z.boolean().optional(),
  position: z.enum(['floating', 'right', 'bottom', 'inline']).optional(),
  defaultOpen: z.boolean().optional(),
  historyEnabled: z.boolean().optional(),
  showFeedback: z.boolean().optional(),
  verboseTools: z.boolean().optional(),
  scopeMode: z.enum(['optional', 'required']).optional(),
  allowedDomains: z.array(z.string().min(1)).optional(),
  theme: z
    .object({
      headerText: z.string().min(1).optional(),
      placeholder: z.string().min(1).optional(),
      emptyStateText: z.string().min(1).optional(),
      primaryColor: z.string().min(1).optional(),
      mode: z.enum(['light', 'dark', 'auto']).optional(),
    })
    .optional(),
}).optional();

/**
 * Schema for amodal.json.
 */
export const AmodalConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  /** Custom base system prompt. When omitted, the platform default is used. */
  basePrompt: z.string().optional(),
  /** Embeddable chat widget configuration. */
  embed: EmbedConfigSchema,
  /** Subagent names to disable (e.g., ['explore', 'plan'] to turn off platform defaults) */
  disabledSubagents: z.array(z.string()).optional(),
  models: z.object({
    main: ModelConfigSchema.optional(),
    simple: ModelConfigSchema.optional(),
    advanced: ModelConfigSchema.optional(),
  }).optional(),
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
  /**
   * Installed npm packages to load. Each entry is either:
   *   - A bare string `"@scope/connection-foo"` — load every sub-thing in
   *     the package (connections, skills, automations, knowledge, stores,
   *     tools, channels). Default for single-role packages.
   *   - An object `{ package, use }` — load only the listed sub-things.
   *     Each `use` entry is `"<kind>.<name>"`, e.g. `"connections.slack"`
   *     or `"channels.bot"`. Use this when a package ships multiple
   *     roles and the agent only wants a subset.
   */
  packages: z.array(
    z.union([
      z.string().min(1),
      z.object({
        package: z.string().min(1),
        use: z.array(z.string().min(1)).optional(),
      }),
    ]),
  ).optional(),
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
  /** Agent memory configuration. */
  memory: z
    .object({
      /** Whether memory is enabled. */
      enabled: z.boolean(),
      /** Who can call the memory tool: 'any' (default), 'admin', or 'none'. */
      editableBy: z.enum(['any', 'admin', 'none']).optional(),
      /** Maximum number of memory entries (default: 50). */
      maxEntries: z.number().int().positive().optional(),
      /** Maximum total characters across all entries (default: 8000). */
      maxTotalChars: z.number().int().positive().optional(),
      /** Nudge interval — prompt agent to save every N turns (default: 10, 0 to disable). */
      nudgeInterval: z.number().int().min(0).optional(),
      /** Enable session search tool (default: true). */
      sessionSearch: z.boolean().optional(),
    })
    .optional(),
  /** File tools for reading/writing agent repo files. */
  fileTools: z.union([
    z.boolean(),
    z.object({
      allowedDirs: z.array(z.string()).optional(),
      blockedFiles: z.array(z.string()).optional(),
    }),
  ]).optional(),
  /** Scope configuration for per-user session isolation. */
  scope: z
    .object({
      /** When true, requests without a scope_id are rejected. Default: false. */
      requireScope: z.boolean().optional(),
    })
    .optional(),
  /**
   * Messaging channel configurations, keyed by channel type.
   * Each channel's config block is validated by the plugin's own Zod schema
   * at runtime — the core schema only enforces the top-level shape.
   */
  /** Local path override for the admin agent (skips the global cache entirely). */
  adminAgent: z.string().optional(),
  /** Pin the admin agent to a specific npm version (e.g. "0.5.0"). */
  adminAgentVersion: z.string().optional(),
});

export type AmodalConfig = z.infer<typeof AmodalConfigSchema>;

/**
 * One entry from amodal.json#packages, normalized into the rich shape.
 * A bare-string entry becomes `{ package, use: undefined }`, meaning
 * "load every sub-thing".
 */
export interface NormalizedPackageEntry {
  package: string;
  /** When present, only sub-things with `<kind>.<name>` keys in this set load. */
  use?: string[];
}

export function normalizePackageEntry(
  entry: NonNullable<AmodalConfig['packages']>[number],
): NormalizedPackageEntry {
  if (typeof entry === 'string') return { package: entry };
  return entry.use ? { package: entry.package, use: entry.use } : { package: entry.package };
}

/**
 * Build an `accept(name)` predicate for a given sub-thing kind, based on
 * a package entry's `use` list. When `use` is undefined the predicate
 * accepts everything ("include all" default).
 *
 * `kind` examples: `'connections'`, `'skills'`, `'channels'`, etc.
 */
export type SubthingKind = 'connections' | 'skills' | 'automations' | 'knowledge' | 'stores' | 'tools' | 'channels';

export function buildSubthingFilter(
  use: string[] | undefined,
  kind: SubthingKind,
): (name: string) => boolean {
  if (!use || use.length === 0) return () => true;
  const accepted = new Set<string>();
  for (const entry of use) {
    const [k, n] = entry.split('.');
    if (k === kind && n) accepted.add(n);
  }
  return (name) => accepted.has(name);
}

/**
 * Options for parseConfigJson.
 */
export interface ParseConfigOptions {
  /** Skip env: resolution — use at build time when credentials aren't available */
  skipEnvResolution?: boolean;
}

/**
 * Parse and validate a config JSON string. Resolves env: references
 * unless skipEnvResolution is set.
 */
export function parseConfigJson(jsonString: string, options?: ParseConfigOptions): AmodalConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new RepoError('CONFIG_PARSE_FAILED', 'Invalid JSON in config file', err);
  }

  let resolved: unknown;
  if (options?.skipEnvResolution) {
    resolved = raw;
  } else {
    try {
      resolved = resolveEnvValues(raw);
    } catch (err) {
      if (err instanceof RepoError) {
        throw err;
      }
      throw new RepoError('CONFIG_PARSE_FAILED', 'Failed to resolve env values', err);
    }
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
