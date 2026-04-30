/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Factory that assembles a permission-gated `ToolContext` for a custom
 * tool handler. Subsequent phases (validation probes, setup_state,
 * proposal card, etc.) call this to bridge the runtime's session state
 * to the SDK shape handlers consume.
 *
 * Permission enforcement happens here at the `ctx.*` boundary —
 * `ctx.fs.writeRepoFile` checks `fs.write`, `ctx.db.execute` checks
 * `db.write`, etc. The check throws `PermissionError` synchronously
 * before invoking the underlying backend, so the offending package
 * cannot side-effect anything just by being called.
 */

import {
  PermissionError,
  type EmitEvent,
  type ToolContext,
  type ToolDbHandle,
  type ToolPermission,
} from './context.js';
import type {FsBackend, RepoDirListing, RepoFileEntry} from './fs/index.js';
import type {PackagePermissions} from './permissions.js';

export interface CreateSdkToolContextOptions {
  // Identity
  agentId: string;
  scopeId: string;
  scopeContext?: Record<string, string>;
  sessionId: string;
  signal: AbortSignal;

  // Tool + package metadata for permission errors
  toolName: string;
  packagePermissions: PackagePermissions;

  // Backends
  fs: FsBackend;
  db: ToolDbHandle;
  fetch: typeof globalThis.fetch;

  // Sink
  emit: (event: EmitEvent) => void;
}

/**
 * Build the SDK `ToolContext` a handler receives.
 *
 * The returned `ctx.fs`, `ctx.db`, and `ctx.fetch` are wrappers that
 * enforce permissions before delegating to the underlying backend.
 * `ctx.emit`, `ctx.log`, and the identity fields are unconditional —
 * every handler can produce log lines and inline blocks regardless of
 * declared permissions.
 */
export function createSdkToolContext(opts: CreateSdkToolContextOptions): ToolContext {
  const declared = new Set<ToolPermission>(opts.packagePermissions.permissions);

  function checkPermission(permission: ToolPermission): void {
    if (declared.has(permission)) return;
    throw new PermissionError(opts.toolName, permission, opts.packagePermissions.packageName);
  }

  const gatedFs: FsBackend = {
    async readRepoFile(repoPath: string): Promise<string> {
      checkPermission('fs.read');
      return opts.fs.readRepoFile(repoPath);
    },
    async writeRepoFile(repoPath: string, content: string): Promise<void> {
      checkPermission('fs.write');
      return opts.fs.writeRepoFile(repoPath, content);
    },
    async readManyRepoFiles(repoPaths: string[]): Promise<RepoFileEntry[]> {
      checkPermission('fs.read');
      return opts.fs.readManyRepoFiles(repoPaths);
    },
    async listRepoFiles(repoPath: string): Promise<RepoDirListing> {
      checkPermission('fs.read');
      return opts.fs.listRepoFiles(repoPath);
    },
    async deleteRepoFile(repoPath: string): Promise<void> {
      checkPermission('fs.write');
      return opts.fs.deleteRepoFile(repoPath);
    },
  };

  const gatedDb: ToolDbHandle = {
    async execute(query) {
      // Require both tiers — `execute` accepts arbitrary SQL and we
      // can't reliably distinguish read from write without parsing.
      // Phase B can split into `query()` / `mutate()` if SDK consumers
      // need finer grain.
      checkPermission('db.read');
      checkPermission('db.write');
      return opts.db.execute(query);
    },
  };

  const gatedFetch: typeof globalThis.fetch = async (input, init) => {
    checkPermission('net.fetch');
    const merged: RequestInit = init ? {...init} : {};
    // Inject the tool's abort signal when the caller didn't pass one,
    // so outbound requests cancel with the tool invocation.
    if (!merged.signal) merged.signal = opts.signal;
    return opts.fetch(input, merged);
  };

  const ctx: ToolContext = {
    agentId: opts.agentId,
    scopeId: opts.scopeId,
    sessionId: opts.sessionId,
    signal: opts.signal,
    emit: opts.emit,
    log(message) {
      opts.emit({type: 'text', text: message});
    },
    fs: gatedFs,
    db: gatedDb,
    fetch: gatedFetch,
  };
  if (opts.scopeContext) ctx.scopeContext = opts.scopeContext;
  return ctx;
}
