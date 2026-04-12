/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';
import type {SessionRuntime, LLMMessage} from '@amodalai/core';
import type {PlanModeManager, ExploreConfig} from '@amodalai/core';
import type {CustomToolExecutor, CustomShellExecutor, StoreBackend, McpManager} from '@amodalai/core';
import type {DeliveryPayload} from '@amodalai/types';

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
  /**
   * ISV callback fired when an automation's delivery config includes a
   * `callback` target. Receives the full delivery payload plus metadata
   * from the callback target (the optional `name` tag) so multi-target
   * setups can distinguish which callback is firing. Invoked via `await`,
   * so returning a promise will hold up subsequent deliveries.
   */
  onAutomationResult?: (
    payload: DeliveryPayload,
    target: {name?: string},
  ) => void | Promise<void>;
  /**
   * Optional hook that produces a 1-2 sentence summary of a tool result
   * being cleared from context. Wired into every `runMessage` call the
   * server makes. Useful for tests and for embedders that want richer
   * summaries than the static `[Tool result cleared]` marker.
   */
  summarizeToolResult?: (opts: {
    toolName: string;
    content: string;
    signal: AbortSignal;
  }) => Promise<string>;
  /**
   * Optional RoleProvider for role-gated routes. In `amodal dev`, defaults to
   * the everyone-is-ops provider since the developer is the only user.
   * Self-hosted deployments can plug in their own auth.
   */
  roleProvider?: import('../role-provider.js').RoleProvider;
  /** URL of the Studio service. Defaults to `process.env.STUDIO_URL` or null. */
  studioUrl?: string;
  /** URL of the admin agent service. Defaults to `process.env.ADMIN_AGENT_URL` or null. */
  adminAgentUrl?: string;
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
