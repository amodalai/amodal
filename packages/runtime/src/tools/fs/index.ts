/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Filesystem backend abstraction for custom tool handlers.
 *
 * The runtime picks an implementation based on `AMODAL_REPO_MODE`:
 * - `local` (default, used by `amodal dev`) — `LocalFsBackend` reads and
 *   writes the repo directly via `fs/promises`, sandboxed to the repo root.
 * - `cloud` — `PlatformApiFsBackend` (tracked under Phase 0G) wraps
 *   `cloud-phase-4/platform-api`'s `/api/repo/files/*` routes so the same
 *   handler code commits to platform-api's persistent clone.
 *
 * Handlers don't reason about which backend they're talking to. The
 * observable difference is latency (local: sub-ms, cloud: ~20-50ms per
 * write per the Phase 0G plan); semantics are identical.
 *
 * **Sandboxing.** Every backend method MUST resolve the input path and
 * assert it sits under the repo root before reading or writing. The
 * `LocalFsBackend` enforces this with a normalize-and-prefix-check; cloud
 * routes do the same on the server side.
 */

/** A single file's content paired with its repo-relative path. */
export interface RepoFileEntry {
  path: string;
  content: string;
}

/** A directory listing result — directories vs files at a single level. */
export interface RepoDirListing {
  /** Subdirectory names (no trailing slash, no recursion). */
  directories: string[];
  /** File names. */
  files: string[];
}

/**
 * The fs surface a tool handler sees through `ctx.fs`.
 *
 * All paths are repo-relative. Absolute paths and `..` traversal are
 * rejected — the backend throws when a resolved path escapes the repo
 * root.
 */
export interface FsBackend {
  /**
   * Read a file's text content. Throws if the file does not exist or the
   * path escapes the sandbox.
   */
  readRepoFile(repoPath: string): Promise<string>;

  /**
   * Write a file atomically (write-to-temp, rename). Creates parent
   * directories as needed. Overwrites existing files.
   */
  writeRepoFile(repoPath: string, content: string): Promise<void>;

  /**
   * Read multiple files in parallel. Files that do not exist are omitted
   * from the result rather than throwing — callers that need strict
   * presence should call `readRepoFile` per path.
   */
  readManyRepoFiles(repoPaths: string[]): Promise<RepoFileEntry[]>;

  /**
   * List the immediate contents of a directory. Returns empty arrays for
   * a missing directory (rather than throwing) so callers can probe for
   * optional content like `tools/`.
   */
  listRepoFiles(repoPath: string): Promise<RepoDirListing>;

  /**
   * Delete a file. Throws on a missing file (callers wanting silent skip
   * should check existence first via `listRepoFiles`). Never deletes
   * directories — out of scope for the SDK.
   */
  deleteRepoFile(repoPath: string): Promise<void>;
}

/** Repo deployment mode — selects which `FsBackend` the runtime instantiates. */
export type RepoMode = 'local' | 'cloud';

/**
 * Thrown by an `FsBackend` when the input path escapes the repo sandbox
 * or is otherwise rejected.
 */
export class FsSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FsSandboxError';
  }
}
