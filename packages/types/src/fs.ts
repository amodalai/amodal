/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Filesystem backend abstraction for custom tool handlers.
 *
 * Lives in `@amodalai/types` (not `@amodalai/runtime`) so both the
 * legacy `CustomToolContext` and the new SDK `ToolContext` can carry
 * the same `fs?: FsBackend` field without anyone reaching into runtime
 * internals. Concrete implementations (`LocalFsBackend`, the future
 * `PlatformApiFsBackend`) live in `@amodalai/runtime/src/tools/fs/`;
 * this file is just the contract.
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
 * root. Sandboxing is enforced by the implementation, not the caller.
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
