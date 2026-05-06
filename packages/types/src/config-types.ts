/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A model configuration entry.
 */
export interface ModelConfig {
  provider: string;
  model: string;
  region?: string;
  baseUrl?: string;
  fallback?: ModelConfig;
  credentials?: Record<string, string>;
}

/**
 * Configuration for the built-in web_search and fetch_url tools.
 *
 * When present, the runtime registers both tools on every session, backed
 * by a dedicated Gemini Flash provider instance with Google Search +
 * urlContext grounding enabled. The provider is independent of the
 * main agent model — Anthropic/OpenAI agents get search through the
 * same Gemini backend.
 */
export interface WebToolsConfig {
  /** Search/fetch backend. Only 'google' (Gemini grounding) is supported today. */
  readonly provider: 'google';
  /** API key (resolved from env: refs by core parser). */
  readonly apiKey: string;
  /** Gemini model name. Default: 'gemini-2.5-flash'. */
  readonly model?: string;
}

/**
 * Configuration for agent memory — per-instance persistent context.
 *
 * When enabled, the agent stores memory entries (one fact per row) that
 * persist across sessions. The agent can read them in its system prompt
 * and manage them via the built-in memory tool (add/remove/list/search).
 */
export interface MemoryConfig {
  /** Whether memory is enabled for this agent. */
  readonly enabled: boolean;
  /**
   * Who can call the memory tool:
   * - 'any'  — any user (default)
   * - 'admin' — only admin sessions
   * - 'none' — memory is read-only (set via admin agent or API)
   */
  readonly editableBy?: 'any' | 'admin' | 'none';
  /** Maximum number of memory entries (default: 50). */
  readonly maxEntries?: number;
  /** Maximum total characters across all entries (default: 8000). */
  readonly maxTotalChars?: number;
  /** Nudge interval — prompt agent to save every N turns (default: 10, 0 to disable). */
  readonly nudgeInterval?: number;
  /** Enable session search tool (default: true when memory is enabled). */
  readonly sessionSearch?: boolean;
}

export interface EmbedThemeConfig {
  headerText?: string;
  placeholder?: string;
  emptyStateText?: string;
  primaryColor?: string;
  mode?: 'light' | 'dark' | 'auto';
}

export interface EmbedConfig {
  enabled?: boolean;
  position?: 'floating' | 'right' | 'bottom' | 'inline';
  defaultOpen?: boolean;
  historyEnabled?: boolean;
  showFeedback?: boolean;
  verboseTools?: boolean;
  scopeMode?: 'optional' | 'required';
  allowedDomains?: string[];
  theme?: EmbedThemeConfig;
}

/**
 * The parsed amodal.json configuration.
 */
export interface AmodalConfig {
  name: string;
  version: string;
  description?: string;
  basePrompt?: string;
  embed?: EmbedConfig;
  disabledSubagents?: string[];
  models?: {
    main?: ModelConfig;
    simple?: ModelConfig;
    advanced?: ModelConfig;
  };
  proactive?: {
    webhook: string;
  };
  platform?: {
    projectId: string;
    apiKey: string;
  };
  sandbox?: {
    shellExec: boolean;
    template?: string;
    maxTimeout: number;
  };
  stores?: {
    dataDir?: string;
    backend: 'pglite' | 'postgres';
    postgresUrl?: string;
  };
  webTools?: WebToolsConfig;
  /**
   * Installed npm packages to load. Each entry is either:
   *   - A bare string `"@scope/connection-foo"` — load every sub-thing in
   *     the package (default for single-role packages).
   *   - `{ package, use }` — load only the listed sub-things. `use`
   *     entries are `"<kind>.<name>"` strings, e.g. `"connections.slack"`.
   */
  packages?: Array<string | { package: string; use?: string[] }>;
  mcp?: {
    servers: Record<string, {
      transport: 'stdio' | 'sse' | 'http';
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
      trust?: boolean;
    }>;
  };
  /** Agent memory configuration. */
  memory?: MemoryConfig;
  /** File tools for reading/writing agent repo files. */
  fileTools?: boolean | {
    allowedDirs?: string[];
    blockedFiles?: string[];
  };
  /** Scope configuration for per-user session isolation. */
  scope?: {
    /** When true, requests without a scope_id are rejected. Default: false. */
    requireScope?: boolean;
  };
}
