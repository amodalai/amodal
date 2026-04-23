/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { DraftFile, PublishResult, WorkspaceBundle } from './types';

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

/**
 * The storage + operations backend for the Studio.
 */
export interface StudioBackend {
  // -------------------------------------------------------------------------
  // Draft CRUD
  // -------------------------------------------------------------------------

  /** List all draft files for a user. */
  listDrafts(userId: string): Promise<DraftFile[]>;

  /** Read a single draft file. Returns null if not found. */
  readDraft(userId: string, filePath: string): Promise<DraftFile | null>;

  /** Save (upsert) a draft file. */
  saveDraft(userId: string, filePath: string, content: string): Promise<void>;

  /** Delete a single draft file. */
  deleteDraft(userId: string, filePath: string): Promise<void>;

  /** Delete all drafts for a user. */
  discardAllDrafts(userId: string): Promise<number>;

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  /** Publish all drafts (write to disk in local dev, commit via GitHub in cloud). */
  publishDrafts(userId: string): Promise<PublishResult>;

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  /** Get the full workspace file bundle. */
  getWorkspace(): Promise<WorkspaceBundle>;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Initialize the backend (create tables, etc.). */
  initialize(): Promise<void>;
}
