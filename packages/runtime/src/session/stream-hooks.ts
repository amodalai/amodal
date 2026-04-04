/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Stream hooks type (extracted from session-runner.ts in Phase 3.5f).
 *
 * These callbacks are invoked by route handlers after runMessage() drains.
 * Hosted-mode consumers use them for audit logging, usage reporting, and
 * external persistence.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/**
 * Hooks invoked by chat route handlers after the message stream completes.
 */
export interface StreamHooks {
  /** Log an audit event */
  onAuditLog?: (entry: {event: string; resource_name: string; details?: Record<string, unknown>}) => void;
  /** Report token usage after each turn (fire-and-forget) */
  onUsageReport?: (usage: {model: string; taskAgentRuns: number; tokens: TokenCounts}) => void;
  /** Persist session history (fire-and-forget). Messages array is empty for new-stack sessions. */
  onSessionPersist?: (sessionId: string, messages: unknown[], status: 'active' | 'completed' | 'error', meta?: {model?: string; provider?: string}) => void;
}
