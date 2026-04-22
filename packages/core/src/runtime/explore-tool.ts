/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Configuration for an explore sub-agent invocation.
 * The actual agent execution is handled by the runtime server.
 * This module prepares the context, model selection, and constraints.
 */

import type {ModelConfig} from '../repo/config-schema.js';
import type {ConnectionsMap} from '../templates/connections.js';
import type {SessionRuntime} from './session-setup.js';

export interface ExploreConfig {
  systemPrompt: string;
  model: ModelConfig;
  /** All available model configs for override selection */
  availableModels: {main: ModelConfig; simple?: ModelConfig; advanced?: ModelConfig};
  connectionsMap: ConnectionsMap;
  readOnly: true;
  maxTurns: number;
  maxDepth: number;
}

export interface ExploreRequest {
  query: string;
  endpointHints?: string[];
  parentDepth: number;
}

export interface ExploreResult {
  summary: string;
  tokensUsed: number;
  endpointsQueried: string[];
  truncated: boolean;
}

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_MAX_DEPTH = 2;

/**
 * Prepares the configuration for an explore sub-agent.
 */
export function prepareExploreConfig(
  runtime: SessionRuntime,
  options?: {maxTurns?: number; maxDepth?: number},
): ExploreConfig {
  const models = runtime.repo.config.models ?? {};
  const model = models['simple'] ?? models['main'];

  return {
    systemPrompt: runtime.exploreContext.systemPrompt,
    model: model!,
    availableModels: {main: model!, ...models},
    connectionsMap: runtime.connectionsMap,
    readOnly: true,
    maxTurns: options?.maxTurns ?? DEFAULT_MAX_TURNS,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
}

/**
 * Resolves the effective model for an explore sub-agent call.
 *
 * If the LLM passes a `model` parameter, this resolves it against the
 * available models:
 * - "simple" → the explore/lightweight model
 * - "default" → the default explore model (same as no override)
 * - "advanced" → the main/primary model
 * - "provider:model" → literal override (e.g., "openai:gpt-4o-mini")
 *
 * Otherwise returns the default explore model.
 */
export function resolveExploreModel(
  config: ExploreConfig,
  modelParam?: string,
): ModelConfig {
  if (!modelParam) {
    return config.model;
  }

  const normalized = modelParam.trim().toLowerCase();

  // Named aliases
  if (normalized === 'simple') {
    return config.availableModels.simple ?? config.model;
  }
  if (normalized === 'default') {
    return config.model;
  }
  if (normalized === 'advanced') {
    return config.availableModels.advanced ?? config.availableModels.main;
  }

  // Literal "provider:model" override (e.g., "openai:gpt-4o-mini")
  if (modelParam.includes(':')) {
    const colonIdx = modelParam.indexOf(':');
    const provider = modelParam.slice(0, colonIdx).trim();
    const model = modelParam.slice(colonIdx + 1).trim();
    if (provider && model) {
      return {
        provider,
        model,
        // Inherit credentials from the default explore model so app creds flow through
        credentials: config.model.credentials,
      };
    }
  }

  return config.model;
}

/**
 * Validates an explore request against the config constraints.
 * Returns an error message if invalid, null if valid.
 */
export function validateExploreRequest(
  request: ExploreRequest,
  config: ExploreConfig,
): string | null {
  if (!request.query || request.query.trim().length === 0) {
    return 'Explore query must not be empty';
  }
  if (request.parentDepth >= config.maxDepth) {
    return `Explore request exceeds max depth: parentDepth=${request.parentDepth}, maxDepth=${config.maxDepth}`;
  }
  return null;
}

/**
 * The explore tool name constant.
 */
export const EXPLORE_TOOL_NAME = 'explore';

/**
 * The explore tool definition for LLM tool calling.
 * This is the schema the LLM sees.
 */
export const EXPLORE_TOOL_SCHEMA = {
  name: 'explore',
  description:
    'Delegate data gathering to a focused sub-agent that queries connected systems and returns a concise summary. Use this for broad investigation, parallel data collection, or when you need to gather information from multiple endpoints.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to investigate. Be specific about what data you need.',
      },
      endpoint_hints: {
        type: 'array',
        items: {type: 'string'},
        description:
          'Optional: specific endpoint paths to prioritize (e.g., "/api/contacts", "/api/deals").',
      },
      model: {
        type: 'string',
        description:
          'Optional: model to use for this sub-agent. Use "simple" for the lightweight model, "default" for the standard explore model, "advanced" for the primary model, or "provider:model" for a specific model (e.g., "openai:gpt-4o-mini").',
      },
    },
    required: ['query'],
  },
} as const;
