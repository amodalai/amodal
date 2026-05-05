/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Custom-tool SDK — `ToolContext` and supporting types.
 *
 * This is the public surface custom tool handlers in agent packages
 * (`agent-admin`, `connection-*`, `template-*`) program against. It sits
 * alongside (and is structurally a superset of) the legacy
 * `CustomToolContext` from `@amodalai/types`: existing v0 tools keep
 * working through that interface, while new tools opt into the richer
 * shape here.
 *
 * Authoring contract:
 * - Tools live at `<agentPackage>/tools/<name>/{tool.json, handler.ts}`.
 * - The runtime auto-discovers them on agent load (Phase 0.3).
 * - The package's `package.json#amodal.permissions` declares which
 *   `ctx.*` capabilities the handlers may use; the runtime throws
 *   `PermissionError` at the boundary if a handler reaches for a
 *   capability the package didn't declare (Phase 0.4 + 0.5).
 *
 * Deliberate omission: there is no `ctx.saveSecret`. Credentials enter
 * the system through the Configure modal (`POST /api/secrets/:name`)
 * or the OAuth callback — never through tool args, never through chat
 * history, never through the LLM's reasoning. Phase 0 closes that
 * surface; future phases must keep it closed.
 */

import type {Block} from '@amodalai/types';
import type {FsBackend} from './fs/index.js';

/**
 * Permissions a tool's package can declare in
 * `package.json#amodal.permissions` to opt into capability tiers.
 *
 * Default-deny: a handler that reaches for `ctx.fs.writeRepoFile` from a
 * package that didn't declare `fs.write` throws `PermissionError`.
 *
 * Note the absence of a `secrets.*` tier — secrets are not reachable
 * through any tool. That is the core security invariant of the SDK.
 */
export type ToolPermission =
  | 'fs.read'
  | 'fs.write'
  | 'db.read'
  | 'db.write'
  | 'net.fetch';

/**
 * Structured event a tool emits to the chat surface. The widget routes
 * each variant to the right rendering path:
 * - `text` is appended as agent prose alongside the LLM's stream.
 * - `block` is dispatched into the message list and rendered by the
 *   widget's built-in renderers (or by Studio's `inlineBlockRenderers`
 *   for Studio-owned types like `connection_panel`).
 * - `error` surfaces an inline error notice and is logged server-side.
 */
export type EmitEvent =
  | {type: 'text'; text: string}
  | {type: 'block'; block: Block}
  | {type: 'error'; message: string};

/**
 * Minimal Drizzle-shaped query interface exposed via `ctx.db`. Kept
 * intentionally narrow — handlers should use the per-domain query
 * modules in `@amodalai/db/queries/<domain>.ts` (Midday pattern), which
 * accept a `db` first arg and return typed results.
 *
 * `ctx.db` is scoped to the agent's session: the runtime injects the
 * connection bound to the current agent + scope.
 */
export interface ToolDbHandle {
  /**
   * Execute a parameterized query and return raw rows. Prefer the
   * per-domain query modules over raw SQL; this is here for cases where
   * a tool genuinely needs to compose its own statement.
   */
  execute<T = unknown>(query: {sql: string; params?: unknown[]}): Promise<T[]>;
}

/**
 * The context object passed as the second argument to every custom-tool
 * handler. The first argument is the validated `params` object; the
 * runtime parses `tool.json#parameters` and rejects malformed calls
 * before reaching `execute`.
 *
 * **What the runtime guarantees:**
 * - `signal` is aborted on cancellation, timeout, or session end.
 * - `agentId` and `scopeId` reflect the live session, not stale state.
 * - `fs`, `db`, and `fetch` throw `PermissionError` when the package
 *   didn't declare the matching capability.
 * - `emit` may be called any number of times per invocation — events
 *   are streamed in the order they're emitted.
 */
export interface ToolContext {
  // -------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------

  /** The agent this tool is running on behalf of. */
  agentId: string;

  /** Per-user session isolation key. Empty string = agent-level (no scope). */
  scopeId: string;

  /** Scope context key-value pairs associated with this scope, if any. */
  scopeContext?: Record<string, string>;

  /** Session id for log correlation. */
  sessionId: string;

  // -------------------------------------------------------------------
  // Side effects
  // -------------------------------------------------------------------

  /**
   * Emit a structured event. The chat surface routes the event to the
   * right renderer (text into the agent prose stream, blocks into the
   * inline-block list, errors into the error notice line).
   *
   * Tools that don't produce inline UI never call `emit`.
   */
  emit(event: EmitEvent): void;

  /** Append a single text fragment — sugar for `emit({type:'text', text})`. */
  log(message: string): void;

  // -------------------------------------------------------------------
  // Capabilities (permission-gated)
  // -------------------------------------------------------------------

  /**
   * Repo-relative file access. Requires `fs.read` / `fs.write` in
   * `package.json#amodal.permissions`. Sandboxed to the agent's repo
   * root — paths that escape the sandbox throw `FsSandboxError`.
   */
  fs: FsBackend;

  /**
   * Drizzle handle scoped to the agent's session. Requires `db.read` /
   * `db.write` in `package.json#amodal.permissions`.
   */
  db: ToolDbHandle;

  /**
   * HTTP fetch. Requires `net.fetch` in `package.json#amodal.permissions`.
   * The signature mirrors `globalThis.fetch`. The runtime injects
   * `ctx.signal` automatically when the caller doesn't pass one, so
   * outbound requests are cancelled with the tool invocation.
   */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;

  // -------------------------------------------------------------------
  // Abort signal
  // -------------------------------------------------------------------

  /**
   * Aborted on tool timeout, session cancellation, or runtime shutdown.
   * Tools that perform their own awaits (sleep, polling) should listen
   * to this rather than spinning past it.
   */
  signal: AbortSignal;
}

/**
 * Thrown when a tool reaches for a capability its package didn't
 * declare in `package.json#amodal.permissions`. The message names both
 * the offending tool and the missing permission so the author can fix
 * the manifest in one place.
 */
export class PermissionError extends Error {
  /** Tool that triggered the check. */
  readonly toolName: string;
  /** Permission that was missing. */
  readonly permission: ToolPermission;
  /** npm package name that owns the tool. */
  readonly packageName: string;

  constructor(
    toolName: string,
    permission: ToolPermission,
    packageName: string,
  ) {
    super(
      `Tool "${toolName}" tried to use capability "${permission}" but ` +
        `package "${packageName}" did not declare it in ` +
        `package.json#amodal.permissions. Add "${permission}" to the ` +
        `permissions array to grant access.`,
    );
    this.name = 'PermissionError';
    this.toolName = toolName;
    this.permission = permission;
    this.packageName = packageName;
  }
}
