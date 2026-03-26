/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { ChainToolConfigSchema, type ChainToolConfig } from './chain-tool-types.js';
import { ChainTool } from './chain-tool.js';
import type { ToolRegistry } from '@google/gemini-cli-core';
import type { ConnectionsMap } from '../templates/connections.js';
import type { MessageBus } from '@google/gemini-cli-core';
import { debugLogger } from '@google/gemini-cli-core';

export interface RegisterChainToolsResult {
  registered: string[];
  errors: Array<{ index: number; error: string }>;
}

/**
 * Validate and register chain tool configs into the tool registry.
 * Invalid configs produce errors but don't block other registrations.
 */
export function registerChainTools(
  registry: ToolRegistry,
  configs: unknown[],
  connections: ConnectionsMap,
  messageBus: MessageBus,
): RegisterChainToolsResult {
  const registered: string[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < configs.length; i++) {
    const raw = configs[i];
    const parsed = ChainToolConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      errors.push({ index: i, error: errorMsg });
      debugLogger.log(`Chain tool config #${i} invalid: ${errorMsg}`);
      continue;
    }

    const config: ChainToolConfig = parsed.data;

    // Validate unique step names
    const stepNames = new Set<string>();
    let hasDuplicateSteps = false;
    for (const step of config.steps) {
      if (stepNames.has(step.name)) {
        errors.push({ index: i, error: `Duplicate step name: "${step.name}"` });
        debugLogger.log(`Chain tool config #${i} has duplicate step name: "${step.name}"`);
        hasDuplicateSteps = true;
        break;
      }
      stepNames.add(step.name);
    }
    if (hasDuplicateSteps) {
      continue;
    }

    const tool = new ChainTool(config, connections, messageBus);
    registry.registerTool(tool);
    registered.push(config.name);
  }

  return { registered, errors };
}
