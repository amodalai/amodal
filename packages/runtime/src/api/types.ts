/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Public API types for the Amodal runtime.
 *
 * These are the only types ISV consumers should depend on.
 * Internal types (state machine, tool registry internals, etc.)
 * are not exported from the public API.
 */

import type {AgentBundle, StoreBackend} from '@amodalai/types';
import type {McpManager} from '@amodalai/core';
import type {LLMProvider, ProviderConfig} from '../providers/types.js';
import type {Session} from '../session/types.js';
import type {SSEEvent} from '../types.js';
import type {StreamHooks} from '../session/stream-hooks.js';
import type {Logger} from '../logger.js';

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

/** Configuration for creating an agent. */
export interface AgentConfig {
  /** Path to the agent repo (local mode). */
  repoPath?: string;
  /** Pre-loaded agent bundle (alternative to repoPath). */
  bundle?: AgentBundle;
  /** LLM provider override (default: created from bundle model config). */
  provider?: LLMProvider;
  /** Provider config override (default: from bundle model config). */
  providerConfig?: ProviderConfig;
  /** Custom store backend (default: PGLite in .amodal/store-data). */
  storeBackend?: StoreBackend;
  /** MCP manager (default: created from bundle MCP configs). */
  mcpManager?: McpManager;
  /** Logger (default: built-in structured logger). */
  logger?: Logger;
  /** Session TTL in milliseconds (default: 30 minutes). */
  sessionTtlMs?: number;
  /** Stream hooks for audit logging, usage reporting, and persistence. */
  streamHooks?: StreamHooks;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/** A running agent instance. */
export interface Agent {
  /** Create a new chat session. */
  createSession(): AgentSession;

  /** Resume an existing session by ID. Returns null if not found. */
  resumeSession(sessionId: string): Promise<AgentSession | null>;

  /** Get the agent's compiled system prompt. */
  getSystemPrompt(): string;

  /** Get the agent bundle. */
  getBundle(): AgentBundle;

  /** Shut down the agent (close store, MCP, cleanup). */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** A chat session — send messages and receive SSE events. */
export interface AgentSession {
  /** Session ID. */
  readonly id: string;

  /** Send a message and stream SSE events back. */
  stream(
    message: string,
    opts?: {signal?: AbortSignal},
  ): AsyncGenerator<SSEEvent>;

  /** The underlying session object (for advanced use). */
  readonly session: Session;
}
