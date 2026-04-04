/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session types for the standalone session manager (Phase 3.4).
 *
 * These are separate from the legacy session-manager.ts types. The old
 * types (ManagedSession, SessionMessage, etc.) remain for the upstream
 * code path until Phase 3 is fully complete.
 */

import type {ModelMessage} from 'ai';
import type {TokenUsage, LLMProvider} from '../providers/types.js';
import type {ToolRegistry} from '../tools/types.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import type {Logger} from '../logger.js';

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
 * All fields from the design doc are defined here. Only `schedule`,
 * `prompt`, and `enabled` are implemented in Phase 3. The parser reads
 * and validates the full schema; unimplemented fields are stored but
 * ignored. When roadmap features ship, the config is already parsed.
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
  /** Delivery routing — parsed now, implemented in roadmap 3.1 */
  delivery?: {
    on: 'completion' | 'new_results';
    targets: Array<{type: 'webhook' | 'callback'; url?: string}>;
    template?: string;
  };
  /** Failure alerting — parsed now, implemented in roadmap 3.1 */
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
export interface PersistedSession {
  version: 1;
  id: string;
  tenantId: string;
  userId: string;
  messages: ModelMessage[];
  tokenUsage: TokenUsage;
  metadata: SessionMetadata;
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
  tenantId: string;
  userId: string;

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

  /** User roles for permission checks and field guidance */
  userRoles: string[];

  /** App ID for multi-app isolation */
  appId: string;

  /** Session metadata (title, automation info, etc.) */
  metadata: SessionMetadata;

  /** Timestamps */
  createdAt: number;
  lastAccessedAt: number;

  /** Max turns for the agent loop */
  maxTurns: number;
  /** Max context tokens (provider limit) */
  maxContextTokens: number;
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
}

/** Options for creating a new session. */
export interface CreateSessionOptions {
  tenantId: string;
  userId: string;
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  permissionChecker: PermissionChecker;
  systemPrompt: string;
  appId?: string;
  metadata?: SessionMetadata;
  maxTurns?: number;
  maxContextTokens?: number;
  /** Optional: seed messages for resuming */
  messages?: ModelMessage[];
  /** Optional: seed token usage for resuming */
  usage?: TokenUsage;
  /** User roles for permission checks and field guidance */
  userRoles?: string[];
  /** Optional: onUsage callback fired after each turn */
  onUsage?: (usage: TurnUsage) => void;
}
