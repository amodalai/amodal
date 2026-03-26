/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AuditLogger } from './audit/index.js';
import type { ConnectionsMap } from './templates/index.js';
import type { KnowledgeStore } from './knowledge/knowledge-store.js';
import type { ConnectionInfo } from './platform/platform-types.js';
import type { LoadedStore } from './repo/store-types.js';
import type { StoreBackend } from './stores/store-backend.js';

/**
 * Narrow interface exposing only the config surface that amodal tools need.
 * AmodalConfig implements this. Tool classes depend on ToolContext rather than
 * the full Config or AmodalConfig, keeping them decoupled from the composition
 * wrapper.
 */
export interface ToolContext {
  getSessionId(): string;
  getPlatformApiUrl(): string | undefined;
  getPlatformApiKey(): string | undefined;
  getApplicationId(): string | undefined;
  getTenantId(): string | undefined;
  getAuditLogger(): AuditLogger | undefined;
  getConnections(): ConnectionsMap;
  getKnowledgeStore(): KnowledgeStore;
  getConnectionInfos(): ConnectionInfo[];
  getAgentContext(): string | undefined;
  getStores(): LoadedStore[];
  getStoreBackend(): StoreBackend | undefined;
  /** Session-scoped environment variables (tenant secrets). */
  getSessionEnv(): Record<string, string>;
}
