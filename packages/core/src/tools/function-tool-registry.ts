/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { FunctionToolConfigSchema, type FunctionToolConfig, type FunctionHandlerMap } from './function-tool-types.js';
import { FunctionTool } from './function-tool.js';
import type { ToolRegistry } from '@google/gemini-cli-core';
import type { ConnectionsMap } from '../templates/connections.js';
import type { MessageBus } from '@google/gemini-cli-core';
import { debugLogger } from '@google/gemini-cli-core';

export interface RegisterFunctionToolsResult {
  registered: string[];
  errors: Array<{ index: number; error: string }>;
}

/**
 * Validate and register function tool configs into the tool registry.
 * Each config must reference a handler that exists in the handler map.
 * Invalid configs produce errors but don't block other registrations.
 */
export function registerFunctionTools(
  registry: ToolRegistry,
  configs: unknown[],
  handlers: FunctionHandlerMap,
  connections: ConnectionsMap,
  messageBus: MessageBus,
): RegisterFunctionToolsResult {
  const registered: string[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < configs.length; i++) {
    const raw = configs[i];
    const parsed = FunctionToolConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      errors.push({ index: i, error: errorMsg });
      debugLogger.log(`Function tool config #${i} invalid: ${errorMsg}`);
      continue;
    }

    const config: FunctionToolConfig = parsed.data;

    // Validate that the handler exists
    const handler = handlers.get(config.handler);
    if (!handler) {
      errors.push({
        index: i,
        error: `Handler "${config.handler}" not found in handler map`,
      });
      debugLogger.log(
        `Function tool config #${i} ("${config.name}"): handler "${config.handler}" not found`,
      );
      continue;
    }

    const tool = new FunctionTool(config, handler, connections, messageBus);
    registry.registerTool(tool);
    registered.push(config.name);
  }

  return { registered, errors };
}
