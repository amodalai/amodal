/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session types for the standalone session manager.
 */

import type {ModelMessage} from 'ai';
import type {RuntimeEventPayload, IntentDefinition} from '@amodalai/types';
import type {TokenUsage, LLMProvider} from '../providers/types.js';
import type {ToolRegistry, ToolContext} from '../tools/types.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import type {Logger} from '../logger.js';

/** Minimal event bus surface the session manager needs. */
export interface SessionEventBus {
  emit: (payload: RuntimeEventPayload) => unknown;
}

// ---------------------------------------------------------------------------
// Turn usage (reported via onUsage hook)
// ---------------------------------------------------------------------------

/**
 * Token usage for a single turn (one LLM call + tool executions).
 * Reported via the `onUsage` callback on AgentContext.
 */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  turnNumber: number;
}

// ---------------------------------------------------------------------------
// Automation config (full type — parsed now, some fields implemented later)
// ---------------------------------------------------------------------------

/**
 * Full automation configuration from the agent repo.
 *
 * All fields are defined here. Only `schedule`, `prompt`, and `enabled`
 * are currently implemented. The parser reads and validates the full
 * schema; unimplemented fields are stored but ignored, so when future
 * features ship the config is already parsed.
 */
export interface AutomationConfig {
  name: string;
  description?: string;
  /** Cron expression */
  schedule: string;
  /** IANA timezone (default: UTC) */
  timezone?: string;
  prompt: string;
  /** LLM model override (default: primary model) */
  model?: string;
  /** Max turns per run (default: 15) */
  maxTurns?: number;
  /** Max tokens per run */
  budget?: number;
  /** Delivery routing — parsed but not yet wired to a delivery mechanism */
  delivery?: {
    on: 'completion' | 'new_results';
    targets: Array<{type: 'webhook' | 'callback'; url?: string}>;
    template?: string;
  };
  /** Failure alerting — parsed but not yet wired to a delivery mechanism */
  failureAlert?: {
    after: number;
    targets: Array<{type: 'webhook' | 'callback'; url?: string}>;
    cooldownMinutes?: number;
  };
  enabled: boolean;
}

/**
 * Result of an automation run (returned to onAutomationResult hook).
 */
export interface AutomationResult {
  automation: string;
  response: string;
  toolCalls: Array<{
    toolName: string;
    toolId: string;
    status: 'success' | 'error';
    durationMs?: number;
  }>;
  outputSent: boolean;
  durationMs: number;
  usage: TokenUsage;
}

// ---------------------------------------------------------------------------
// Persisted session (versioned)
// ---------------------------------------------------------------------------

/**
 * Shape of a persisted session record in the database.
 * Versioned from day one so we can migrate the format later.
 */
/** Map of image ref IDs to their base64 data, stored alongside messages. */
export type ImageDataMap = Record<string, {mimeType: string; data: string}>;

export interface PersistedSession {
  version: 1;
  id: string;
  /** Scope ID for per-user session isolation. '' means agent-level. */
  scopeId: string;
  messages: ModelMessage[];
  tokenUsage: TokenUsage;
  metadata: SessionMetadata;
  /** Image blobs extracted from messages to avoid JSONB bloat on the messages column. */
  imageData: ImageDataMap;
  createdAt: Date;
  updatedAt: Date;
}

/** Metadata stored alongside a session. */
export interface SessionMetadata {
  title?: string;
  model?: string;
  provider?: string;
  appId?: string;
  automationName?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Session (runtime representation)
// ---------------------------------------------------------------------------

/**
 * A live session managed by the standalone SessionManager.
 *
 * This is the runtime representation — it holds the components needed
 * to execute messages via the agent loop. Separate from the persisted
 * session which only holds serializable data.
 */
export interface Session {
  id: string;

  /** LLM provider for this session (pinned at creation) */
  provider: LLMProvider;
  /** Tool registry holding all available tools */
  toolRegistry: ToolRegistry;
  /** Permission checker for tool execution */
  permissionChecker: PermissionChecker;
  /** Logger scoped to this session */
  logger: Logger;
  /** Compiled system prompt */
  systemPrompt: string;

  /** Mutable: conversation messages */
  messages: ModelMessage[];
  /** Mutable: accumulated token usage */
  usage: TokenUsage;

  /** Model identifier (pinned at creation, survives resume) */
  model: string;
  /** Provider name (pinned at creation, survives resume) */
  providerName: string;

  /** App ID for multi-app isolation */
  appId: string;

  /** Scope ID for per-user session isolation ('' means agent-level). */
  scopeId: string;

  /** Session metadata (title, automation info, etc.) */
  metadata: SessionMetadata;

  /** Timestamps */
  createdAt: number;
  lastAccessedAt: number;

  /** Max turns for the agent loop */
  maxTurns: number;
  /** Max context tokens (provider limit) */
  maxContextTokens: number;
  /** Optional total-token budget; loop stops with reason `budget_exceeded` */
  maxSessionTokens?: number;

  /** Tool context factory cached from session creation (avoids rebuilding per request) */
  toolContextFactory?: (callId: string) => ToolContext;

  /**
   * Deterministic intents loaded from the agent's `intents/` directory.
   * Each user message is tested against these regexes before the agent
   * loop runs; on first match, the intent's handler executes the tool
   * sequence and the LLM is skipped. Empty array for agents that don't
   * declare intents (the default).
   */
  intents: IntentDefinition[];
}

// ---------------------------------------------------------------------------
// Session manager options
// ---------------------------------------------------------------------------

/** Options for creating the standalone SessionManager. */
export interface SessionManagerOptions {
  /** Session TTL in milliseconds (default: 30 minutes) */
  ttlMs?: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupIntervalMs?: number;
  /** Logger for the session manager itself */
  logger: Logger;
  /** Default max turns per session (default: 50) */
  defaultMaxTurns?: number;
  /** Default max context tokens (default: 200_000) */
  defaultMaxContextTokens?: number;
  /** Default token budget per session (default: undefined, no cap) */
  defaultMaxSessionTokens?: number;
  /** Optional event bus for emitting session lifecycle events */
  eventBus?: SessionEventBus;
}

/** Options for creating a new session. */
export interface CreateSessionOptions {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  permissionChecker: PermissionChecker;
  systemPrompt: string;
  appId?: string;
  /** Scope ID for per-user session isolation. Default: '' (agent-level). */
  scopeId?: string;
  metadata?: SessionMetadata;
  maxTurns?: number;
  maxContextTokens?: number;
  /** Optional total-token budget; loop stops with `budget_exceeded` when reached */
  maxSessionTokens?: number;
  /** Optional: seed messages for resuming */
  messages?: ModelMessage[];
  /** Optional: seed token usage for resuming */
  usage?: TokenUsage;
  /** Optional: onUsage callback fired after each turn */
  onUsage?: (usage: TurnUsage) => void;
  /** Optional: tool context factory to cache on the session */
  toolContextFactory?: (callId: string) => ToolContext;
  /** Deterministic intents loaded from the agent's `intents/` directory.
   *  Default: empty (no shortcut routing — every turn goes to the LLM). */
  intents?: IntentDefinition[];
}
