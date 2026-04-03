/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Bridge from our ToolDefinition to the upstream gemini-cli-core tool interface.
 *
 * During the SDK swap migration (Phase 2), tools are defined as ToolDefinition
 * objects (Zod schemas, typed execute) but must still be registered on the
 * upstream ToolRegistry so GeminiClient can see them. This bridge adapts
 * our format to the upstream DeclarativeTool shape without `as never` casts.
 *
 * Phase 3 removes this bridge entirely — the new state machine reads
 * tools directly from our local ToolRegistry.
 */

import {zodToJsonSchema} from 'zod-to-json-schema';
import type {ToolDefinition, ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Schema extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract JSON Schema from a ToolDefinition's parameters.
 *
 * Handles both Zod schemas (converted via zod-to-json-schema) and
 * AI SDK jsonSchema() (which already holds raw JSON Schema).
 */
export function extractJsonSchema(def: ToolDefinition): Record<string, unknown> {
  const params = def.parameters;

  // AI SDK jsonSchema() — has a jsonSchema property
  if (params && typeof params === 'object' && 'jsonSchema' in params) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AI SDK Schema boundary
    return (params as unknown as {jsonSchema: Record<string, unknown>}).jsonSchema;
  }

  // Zod schema — convert via zod-to-json-schema
  if (params && typeof params === 'object' && '_def' in params) {
     
    return zodToJsonSchema(params as import('zod').ZodTypeAny) as Record<string, unknown>;
  }

  // Fallback
  return {type: 'object', properties: {}};
}

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Register a bridged tool on the upstream ToolRegistry.
 *
 * This is the SINGLE location where we cast to the upstream type.
 * The upstream registerTool() expects AnyDeclarativeTool, which we
 * can't import. The bridge object structurally satisfies it.
 * Phase 3 removes this entirely.
 */
export function registerOnUpstream(
  upstreamRegistry: unknown,
  bridged: unknown,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream ToolRegistry.registerTool accepts our bridge shape at runtime; Phase 3 deletes this
  (upstreamRegistry as {registerTool(tool: unknown): void}).registerTool(bridged);
}

// ---------------------------------------------------------------------------
// Upstream tool interface (minimal shape for ToolRegistry.registerTool)
// ---------------------------------------------------------------------------

/**
 * Minimal upstream DeclarativeTool interface from gemini-cli-core.
 *
 * Defined locally to avoid importing from upstream internals.
 * Only the fields that ToolRegistry.registerTool() reads are included.
 */
export interface UpstreamToolShape {
  name: string;
  displayName: string;
  description: string;
  kind: 'declarative';
  parameterSchema: Record<string, unknown>;
  isReadOnly: boolean;
  toolAnnotations: undefined;
  schema: {name: string; description: string; parametersJsonSchema: Record<string, unknown>};
  getSchema(): {name: string; description: string; parametersJsonSchema: Record<string, unknown>};
  build(params: Record<string, unknown>): {
    name: string;
    params: Record<string, unknown>;
    execute(): Promise<UpstreamToolResult>;
  };
  silentBuild(params: Record<string, unknown>): ReturnType<UpstreamToolShape['build']>;
  validateBuildAndExecute(params: Record<string, unknown>): Promise<UpstreamToolResult>;
}

interface UpstreamToolResult {
  llmContent: string;
  returnDisplay?: string;
  error?: {message: string; type: string};
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

/**
 * Adapt a ToolDefinition + its JSON Schema to the upstream DeclarativeTool interface.
 *
 * @param name — Tool name for the upstream registry
 * @param def — Our ToolDefinition (Zod schema + execute function)
 * @param jsonSchema — JSON Schema for the tool parameters (the upstream
 *   registry needs JSON Schema, not Zod). For MCP tools this is the
 *   discovered schema; for store/admin/custom tools it's defined inline.
 * @param makeContext — Factory to create a ToolContext for execution
 * @returns An object satisfying the upstream AnyDeclarativeTool interface.
 *   Typed as `unknown` because we can't import the upstream type directly.
 *   Callers pass the result directly to `registerOnUpstream()`.
 *   Phase 3 removes this bridge entirely.
 */
export function bridgeToUpstream(
  name: string,
  def: ToolDefinition,
  jsonSchema: Record<string, unknown>,
  makeContext: () => ToolContext,
): unknown {
  async function executeAndFormat(params: Record<string, unknown>): Promise<UpstreamToolResult> {
    try {
      const ctx = makeContext();
      const result = await def.execute(params, ctx);
      const output = typeof result === 'string' ? result : JSON.stringify(result);
      return {llmContent: output, returnDisplay: output.slice(0, 200)};
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {llmContent: `Error: ${msg}`, returnDisplay: msg, error: {message: msg, type: 'EXECUTION_FAILED'}};
    }
  }

  return {
    name,
    displayName: name,
    description: def.description,
    kind: 'declarative' as const,
    parameterSchema: jsonSchema,
    isReadOnly: def.readOnly,
    toolAnnotations: undefined,
    // Fields required by upstream DeclarativeTool base class but unused in our execution path
    messageBus: null,
    isOutputMarkdown: false,
    canUpdateOutput: false,
    validateToolParams: () => true,
    buildAndExecute: (params: Record<string, unknown>) => executeAndFormat(params),
    getSchema() {
      return {name, description: def.description, parametersJsonSchema: jsonSchema};
    },
    get schema() {
      return {name, description: def.description, parametersJsonSchema: jsonSchema};
    },
    build(params: Record<string, unknown>) {
      return {name, params, execute: () => executeAndFormat(params)};
    },
    silentBuild(params: Record<string, unknown>) {
      return {name, params, execute: () => executeAndFormat(params)};
    },
    validateBuildAndExecute(params: Record<string, unknown>) {
      return executeAndFormat(params);
    },
  };
}
