/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// ---------------------------------------------------------------------------
// Draft types
// ---------------------------------------------------------------------------

/** A single draft file stored in the studio database. */
export interface DraftFile {
  /** Relative path within the agent repo (e.g. "skills/greet.md"). */
  filePath: string;
  /** The full text content of the draft. */
  content: string;
  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Publish types
// ---------------------------------------------------------------------------

/** Result of a publish operation. */
export interface PublishResult {
  /**
   * A reference to the commit or write operation.
   * In local dev: "local-{hash}". In cloud: a git commit SHA.
   */
  commitRef: string;
  /** Number of files published. */
  filesPublished: number;
}

// ---------------------------------------------------------------------------
// Preview types
// ---------------------------------------------------------------------------

/** Result of building a preview snapshot. */
export interface PreviewResult {
  /** Unique ID for this preview snapshot (token-based preview). */
  snapshotId?: string;
  /** Signed token granting access to the preview (token-based preview). */
  token?: string;
  /** Git commit SHA (branch-based preview). */
  commitSha?: string;
  /** Preview branch name (branch-based preview). */
  branch?: string;
}

// ---------------------------------------------------------------------------
// Workspace types
// ---------------------------------------------------------------------------

/** A single file in the workspace bundle. */
export interface WorkspaceFile {
  /** Relative path within the agent repo. */
  path: string;
  /** The full text content of the file. */
  content: string;
}

/** The full workspace bundle returned by GET /api/studio/workspace. */
export interface WorkspaceBundle {
  /** The agent ID (derived from amodal.json or directory name). */
  agentId: string;
  /** All files in the agent's repo. */
  files: WorkspaceFile[];
}

// ---------------------------------------------------------------------------
// Batch types
// ---------------------------------------------------------------------------

/** A single change in a batch request. */
export type BatchChangeAction = 'upsert' | 'delete';

export interface BatchChange {
  /** Relative path within the agent repo. */
  path: string;
  /** The action to perform. */
  action: BatchChangeAction;
  /** Content for upsert actions. Required when action is 'upsert'. */
  content?: string;
}

/** Request body for POST /api/studio/drafts/batch. */
export interface BatchRequest {
  changes: BatchChange[];
}

/** Response body for POST /api/studio/drafts/batch. */
export interface BatchResponse {
  accepted: number;
}

// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

/** Represents the authenticated user making a request. */
export interface StudioUser {
  /** Unique user identifier. */
  userId: string;
  /** Human-readable display name. */
  displayName: string;
}

// ---------------------------------------------------------------------------
// Runtime session history types
// ---------------------------------------------------------------------------

export interface SessionHistoryRow {
  id: string;
  app_id: string;
  scope_id: string;
  title: string;
  message_count: number;
  token_usage: {input_tokens: number; output_tokens: number; total_tokens: number};
  model: string | null;
  provider: string | null;
  cost: SessionCostSnapshot | null;
  created_at: string;
  updated_at: string;
}

export interface SessionCostSnapshot {
  currency: 'USD';
  estimatedCostMicros: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  billableInputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  estimatedCostNoCacheMicros?: number;
  pricing: {
    provider: string;
    model: string;
    inputPerMToken: number;
    outputPerMToken: number;
    cacheReadPerMToken?: number;
    cacheWritePerMToken?: number;
    source: string;
  };
  computedAt: string;
}
