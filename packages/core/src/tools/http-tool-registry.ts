/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { HttpToolConfigSchema, type HttpToolConfig } from './http-tool-types.js';
import { HttpTool } from './http-tool.js';
import type { ToolRegistry } from '@google/gemini-cli-core';
import type { ConnectionsMap } from '../templates/connections.js';
import type { MessageBus } from '@google/gemini-cli-core';
import { debugLogger } from '@google/gemini-cli-core';

export interface RegisterHttpToolsResult {
  registered: string[];
  errors: Array<{ index: number; error: string }>;
}

/**
 * Validate and register HTTP tool configs into the tool registry.
 * Invalid configs produce errors but don't block other registrations.
 */
export function registerHttpTools(
  registry: ToolRegistry,
  configs: unknown[],
  connections: ConnectionsMap,
  messageBus: MessageBus,
): RegisterHttpToolsResult {
  const registered: string[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < configs.length; i++) {
    const raw = configs[i];
    const parsed = HttpToolConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      errors.push({ index: i, error: errorMsg });
      debugLogger.log(`HTTP tool config #${i} invalid: ${errorMsg}`);
      continue;
    }

    const config: HttpToolConfig = parsed.data;
    const tool = new HttpTool(config, connections, messageBus);
    registry.registerTool(tool);
    registered.push(config.name);
  }

  return { registered, errors };
}
