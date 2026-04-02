/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Config } from '@google/gemini-cli-core';
import type { ToolContext } from './tool-context.js';
import { ProposeKnowledgeTool } from './knowledge/propose-knowledge.js';
import { LoadKnowledgeTool } from './knowledge/load-knowledge.js';
import { PresentTool } from './widgets/present-tool.js';
import { RequestTool } from './tools/request-tool.js';
import { StoreWriteTool } from './tools/store-write-tool.js';
import { StoreBatchTool } from './tools/store-batch-tool.js';
import { StoreQueryTool } from './tools/store-query-tool.js';
import {
  registerHttpTools,
  registerChainTools,
  registerFunctionTools,
} from './tools/custom-tool-registrar.js';

/**
 * Register all amodal-specific tools on the upstream Config's ToolRegistry.
 * Called after Config.initialize() so the registry already exists.
 */
export async function registerAmodalTools(
  ctx: ToolContext,
  config: Config,
): Promise<void> {
  const registry = config.getToolRegistry();
  const messageBus = config.getMessageBus();

  // Register propose_knowledge (when platform API is configured)
  const platformApiUrl = ctx.getPlatformApiUrl();
  const platformApiKey = ctx.getPlatformApiKey();
  if (platformApiUrl && platformApiKey) {
    registry.registerTool(new ProposeKnowledgeTool(ctx, messageBus));
  }

  // Register load_knowledge (when KB docs exist)
  const store = ctx.getKnowledgeStore();
  const allDocs = store.getAllDocuments();
  if (allDocs.length > 0) {
    registry.registerTool(new LoadKnowledgeTool(store, messageBus));
  }

  // Register present tool (always available)
  registry.registerTool(new PresentTool(ctx, messageBus));

  // Register request tool (when connections exist)
  const connections = ctx.getConnections();
  if (Object.keys(connections).length > 0) {
    registry.registerTool(new RequestTool(connections, messageBus, false, ctx.getSessionEnv()));
  }

  // Register store tools (when stores + backend exist)
  const stores = ctx.getStores();
  const storeBackend = ctx.getStoreBackend();
  if (stores.length > 0 && storeBackend) {
    const appId = ctx.getApplicationId() ?? 'default';
    for (const store of stores) {
      registry.registerTool(new StoreWriteTool(store, storeBackend, appId, messageBus));
      registry.registerTool(new StoreBatchTool(store, storeBackend, appId, messageBus));
    }
    registry.registerTool(new StoreQueryTool(stores, storeBackend, appId, messageBus));
  }
}

export { registerHttpTools, registerChainTools, registerFunctionTools };
