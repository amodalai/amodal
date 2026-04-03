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
 * The parsed amodal.json configuration.
 */
export interface AmodalConfig {
  name: string;
  version: string;
  description?: string;
  userContext?: string;
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
