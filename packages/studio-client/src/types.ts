/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/** A draft file stored in the Studio workspace. */
export interface DraftFile {
  filePath: string;
  content: string;
  /** ISO-8601 timestamp */
  updatedAt: string;
}

/** Result of a publish operation. */
export interface PublishResult {
  commitSha: string;
  commitUrl?: string;
}

/** Result of a preview build. */
export interface PreviewResult {
  snapshotId: string;
  previewToken: string;
  /** ISO-8601 timestamp */
  expiresAt: string;
}

/** A bundle of workspace files for an agent. */
export interface WorkspaceBundle {
  agentId: string;
  files: WorkspaceFile[];
}

/** A single file within a workspace bundle. */
export interface WorkspaceFile {
  path: string;
  content: string;
}

/** The action type for a workspace change. */
export type WorkspaceChangeAction = 'added' | 'modified' | 'deleted';

/** A change to apply to the workspace via batch diff submission. */
export interface WorkspaceChange {
  path: string;
  action: WorkspaceChangeAction;
  /** Present for 'added' and 'modified' actions, absent for 'deleted'. */
  content?: string;
}
