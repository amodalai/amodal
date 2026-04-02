/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';
import type {SessionRuntime, LLMMessage} from '@amodalai/core';
import type {PlanModeManager, ExploreConfig} from '@amodalai/core';
import type {CustomToolExecutor, CustomShellExecutor, StoreBackend, McpManager} from '@amodalai/core';

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

export const AgentChatRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>;

// ---------------------------------------------------------------------------
// Server config
// ---------------------------------------------------------------------------

export interface LocalServerConfig {
  repoPath: string;
  port: number;
  host?: string;
  hotReload?: boolean;
  sessionTtlMs?: number;
  corsOrigin?: string;
  enableAutomations?: boolean;
  webhookSecret?: string;
  /** Optional middleware to mount after API routes (e.g., Vite dev server for runtime app). */
  appMiddleware?: (req: unknown, res: unknown, next: unknown) => void;
  /** Directory containing pre-built static SPA assets (used when appMiddleware is not provided). */
  staticAppDir?: string;
  /** Session ID to auto-resume on startup. */
  resumeSessionId?: string;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface AgentSession {
  id: string;
  runtime: SessionRuntime;
  appId: string;
  title?: string;
  conversationHistory: LLMMessage[];
  createdAt: number;
  lastAccessedAt: number;
  planModeManager: PlanModeManager;
  exploreConfig: ExploreConfig;
  toolExecutor?: CustomToolExecutor;
  shellExecutor?: CustomShellExecutor;
  storeBackend?: StoreBackend;
  mcpManager?: McpManager;
}
