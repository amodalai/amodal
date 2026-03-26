/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool definition shape used by amodal tools.
 * Mirrors the upstream ToolDefinition interface without importing it
 * (since it's not exported from @google/gemini-cli-core's public API).
 */
export interface ToolDefinition {
  base: {
    name: string;
    description?: string;
    parametersJsonSchema?: Record<string, unknown>;
  };
  overrides?: Record<string, {
    description?: string;
    parametersJsonSchema?: Record<string, unknown>;
  }>;
}
