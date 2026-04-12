/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * UI types for Studio components.
 *
 * These are copies of the types defined in @amodalai/react, kept here so
 * Studio components don't depend on the react package (which carries hooks
 * and runtime dependencies Studio doesn't use).
 */

// ---------------------------------------------------------------------------
// Tool call types
// ---------------------------------------------------------------------------

export type ToolCallStatus = 'running' | 'success' | 'error';

export interface SubagentEventInfo {
  agentName: string;
  eventType: 'tool_call_start' | 'tool_call_end' | 'thought' | 'error' | 'complete';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: string;
}

export interface ToolCallInfo {
  toolId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  duration_ms?: number;
  error?: string;
  subagentEvents?: SubagentEventInfo[];
  /** Ephemeral progress message from the tool executor (via ctx.log). */
  logMessage?: string;
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export interface StoreFieldDefinitionInfo {
  type: string;
  nullable?: boolean;
  values?: string[];
  min?: number;
  max?: number;
  item?: StoreFieldDefinitionInfo;
  fields?: Record<string, StoreFieldDefinitionInfo>;
  store?: string;
}

export interface StoreDocumentMeta {
  computedAt: string;
  ttl?: number;
  stale: boolean;
  automationId?: string;
  skillId?: string;
  modelUsed?: string;
  tokenCost?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  trace?: string;
}

export interface StoreDocument {
  key: string;
  appId: string;
  store: string;
  version: number;
  payload: Record<string, unknown>;
  meta: StoreDocumentMeta;
}
