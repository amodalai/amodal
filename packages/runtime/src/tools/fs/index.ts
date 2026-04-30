/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Filesystem backend implementations for custom tool handlers.
 *
 * The contract (`FsBackend`, `RepoFileEntry`, `RepoDirListing`,
 * `RepoMode`) lives in `@amodalai/types/fs` so the legacy
 * `CustomToolContext` and the new SDK `ToolContext` can share the same
 * shape. This file re-exports those types and adds the runtime-only
 * pieces (the `FsSandboxError` class, plus the concrete `LocalFsBackend`
 * exported from `./local.js`).
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
 */

export type {FsBackend, RepoFileEntry, RepoDirListing, RepoMode} from '@amodalai/types';

/**
 * Thrown by an `FsBackend` when the input path escapes the repo sandbox
 * or is otherwise rejected. Lives here (not in `@amodalai/types`)
 * because it's an Error class, not a pure type.
 */
export class FsSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FsSandboxError';
  }
}
