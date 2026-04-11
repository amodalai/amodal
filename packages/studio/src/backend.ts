/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Studio's backend-agnostic draft workspace contract.
 *
 * A "draft workspace" is the set of pending file edits a specific user has
 * staged but not yet committed to the agent's git repo. All mutations and
 * reads go through this interface so that the editor API, the admin agent's
 * write-file tools, and the preview/publish flows can share one implementation
 * across `amodal dev` (pglite + local filesystem backend) and amodal cloud
 * (Drizzle + Postgres + GitHub App backend).
 *
 * Contract notes (enforced by the shared contract test suite in later PRs):
 *
 * - All draft operations are scoped per `(userId, filePath)`. Two users
 *   editing the same file in the same agent each see only their own drafts.
 * - `getDraft` returning `null` means "this user has no pending draft for
 *   this path" — it is an expected result, not an error. Broken reads throw.
 * - `listDrafts` returns the user's drafts in no guaranteed order; callers
 *   that need ordering sort by `updatedAt`.
 * - `publish` is transactional at the commit level: either every staged draft
 *   lands in one commit, or none do. First-publish-wins under concurrent
 *   publishes (second caller gets a "stale drafts" error and re-stages).
 * - `buildPreview` creates an ephemeral snapshot representing the user's
 *   current drafts layered over the published base. The preview token's TTL
 *   is the backend's choice; callers should treat it as short-lived.
 */
export interface StudioBackend {
  /**
   * Return the draft content for `(userId, filePath)`, or `null` if the user
   * has no pending draft for that path. Does NOT fall back to the published
   * file — this is the staging layer only.
   */
  getDraft(userId: string, filePath: string): Promise<string | null>;

  /**
   * Stage a draft. Creates the row if one doesn't exist or overwrites it if
   * it does. The published file on disk/git is not touched.
   */
  setDraft(userId: string, filePath: string, content: string): Promise<void>;

  /**
   * Drop a single draft row. Idempotent — deleting a non-existent draft is
   * not an error. This is "revert this one pending edit," not "delete the
   * file from the repo" (which is a separate tombstone concern handled at
   * publish time).
   */
  deleteDraft(userId: string, filePath: string): Promise<void>;

  /**
   * List all of the user's current drafts for the current agent. Empty array
   * if the user has no drafts.
   */
  listDrafts(userId: string): Promise<DraftFile[]>;

  /**
   * Drop every draft row for this user in one operation. Used by the
   * editor's "Discard all changes" button.
   */
  discardAll(userId: string): Promise<void>;

  /**
   * Publish every staged draft as a single commit to the agent's git repo.
   * In cloud this calls the GitHub App; in local dev it writes directly to
   * the repo filesystem (no git). On success, drafts are cleared. On
   * failure, drafts remain staged so the user can retry.
   */
  publish(userId: string, commitMessage: string): Promise<PublishResult>;

  /**
   * Build a preview snapshot from the user's current drafts layered over the
   * published base, upload it, and return a signed token plus TTL so the
   * runtime can serve the preview for this session. Does NOT touch the
   * draft rows — the user can keep editing after building a preview.
   */
  buildPreview(userId: string): Promise<PreviewResult>;
}

/**
 * A single staged draft row. `content` is the full file contents (drafts are
 * stored whole, not as diffs).
 */
export interface DraftFile {
  /** Repo-relative POSIX path (e.g. `skills/pricing.md`). */
  filePath: string;
  /** Full file contents as the user most recently saved them. */
  content: string;
  /** ISO-8601 timestamp of the last mutation to this row. */
  updatedAt: string;
}

/**
 * Success result from `publish`. Implementations may carry additional
 * backend-specific metadata (e.g. a pull-request URL) via extension, but the
 * core contract is "here is the commit the drafts became."
 */
export interface PublishResult {
  /** Git commit SHA that the drafts were written into. */
  commitSha: string;
  /** Optional URL to view the commit (GitHub web URL in cloud, undefined in local dev). */
  commitUrl?: string;
}

/**
 * Success result from `buildPreview`. Callers pass the `previewToken` to the
 * runtime via the `X-Amodal-Preview-Token` header or `?preview=` query param;
 * the runtime verifies it and serves `snapshotId` for that session only.
 */
export interface PreviewResult {
  /** Immutable snapshot identifier (matches the R2 object layout). */
  snapshotId: string;
  /** HMAC-signed token carrying `{snapshotId, userId, expiresAt}`. */
  previewToken: string;
  /** ISO-8601 timestamp when the token stops being valid. */
  expiresAt: string;
}

/**
 * Placeholder backend used as the default injection target before concrete
 * backends (`PGLiteStudioBackend`, `DrizzleStudioBackend`) are wired up.
 * Every method throws `StudioNotImplementedError`, which is the signal to
 * callers that they forgot to inject a real backend.
 *
 * This class exists so that consumers can depend on a concrete constructor
 * for type inference rather than casting `null as unknown as StudioBackend`
 * when wiring up imports before the implementation PRs land.
 */
export class NotImplementedStudioBackend implements StudioBackend {
  getDraft(_userId: string, _filePath: string): Promise<string | null> {
    throw new StudioNotImplementedError('getDraft');
  }

  setDraft(_userId: string, _filePath: string, _content: string): Promise<void> {
    throw new StudioNotImplementedError('setDraft');
  }

  deleteDraft(_userId: string, _filePath: string): Promise<void> {
    throw new StudioNotImplementedError('deleteDraft');
  }

  listDrafts(_userId: string): Promise<DraftFile[]> {
    throw new StudioNotImplementedError('listDrafts');
  }

  discardAll(_userId: string): Promise<void> {
    throw new StudioNotImplementedError('discardAll');
  }

  publish(_userId: string, _commitMessage: string): Promise<PublishResult> {
    throw new StudioNotImplementedError('publish');
  }

  buildPreview(_userId: string): Promise<PreviewResult> {
    throw new StudioNotImplementedError('buildPreview');
  }
}

/**
 * Thrown by `NotImplementedStudioBackend` when any of its methods are called.
 * Named so consumers can pattern-match on it to distinguish "I wired this up
 * wrong" from real runtime errors like connection failures.
 */
export class StudioNotImplementedError extends Error {
  constructor(method: string) {
    super(`StudioBackend.${method} is not implemented — inject a concrete backend (PGLiteStudioBackend or DrizzleStudioBackend)`);
    this.name = 'StudioNotImplementedError';
  }
}
