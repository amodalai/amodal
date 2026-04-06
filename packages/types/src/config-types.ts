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
 * The parsed amodal.json configuration.
 */
export interface AmodalConfig {
  name: string;
  version: string;
  description?: string;
  basePrompt?: string;
  disabledSubagents?: string[];
  models: {
    main: ModelConfig;
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
  dependencies?: Record<string, string>;
  webTools?: WebToolsConfig;
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
}
