/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Intent routing — deterministic regex-driven shortcuts that bypass
 * the LLM. See internal-docs/onboarding/intent-routing.md for the full
 * design, especially the install-template walkthrough.
 *
 * Each intent is a regex + an imperative handler that composes a tool
 * sequence via `ctx.callTool(...)`. On match, the runtime runs the
 * handler instead of calling the LLM. The synthetic assistant message
 * appended to the session matches the agent loop's shape exactly so
 * the chat UI can't tell the difference.
 *
 * Restricted to non-confirmation tools — anything with
 * `requiresConfirmation: true` or a connection-tool ACL gate falls
 * through to the LLM. Confirmation gates are exactly where you want
 * LLM judgment.
 */

/**
 * Per-handler context. The runtime builds one of these for each
 * matched intent invocation. `callTool` is the workhorse — handlers
 * compose tool sequences imperatively, awaiting earlier results to
 * shape later params.
 */
export interface IntentContext {
  /** Result of the intent's regex.exec on the user message. */
  match: RegExpExecArray;

  /** The literal user message that matched. */
  userMessage: string;

  /** Session id for telemetry/log correlation. */
  sessionId: string;

  /** Empty string for agent-level scope. */
  scopeId: string;

  /**
   * Invoke a tool from the session's registry. Validates params
   * against the tool's schema, refuses tools that gate on
   * confirmation, then:
   *   1. Emits `tool_call_start` SSE (with friendly running label)
   *   2. Executes the tool against the session's tool context
   *   3. Drains any inline SSE events the tool emitted via ctx.emit
   *      (panels, ask_choice, plan_summary, tool_label_update)
   *   4. Emits `tool_call_result` SSE (with completed label + duration)
   *   5. Records the tool-call part on the in-flight assistant message
   *   6. Appends the tool result message to session.messages
   * Returns the tool's output so the handler can chain into the
   * next call. Throws on tool execution error — handlers can catch
   * and decide whether to recover or propagate (which fails the
   * intent and emits an `error` SSE).
   */
  callTool(toolName: string, params: Record<string, unknown>): Promise<unknown>;

  /**
   * Optional user-visible prose. Goes into the assistant message's
   * text part AND emits a `text_delta` SSE so the user sees it live.
   * Most intents won't need this — the tool-call cards speak for
   * themselves. When called multiple times the texts concatenate.
   */
  emitText(text: string): void;
}

/**
 * Returned by `IntentDefinition.handle`. Two success shapes:
 *
 *   - `{}` — terminal completion. The intent did everything the user
 *     needs to see for this turn (deterministic plumbing AND the
 *     next-step rendering). Runtime appends the synthetic messages
 *     and stops; no LLM round trip.
 *
 *   - `{continue: true}` — deterministic part is done, but the next
 *     step needs LLM judgment (conversational framing, multi-option
 *     ask_choice, optional-batch copy, etc.). Runtime appends the
 *     synthetic messages from the intent AND THEN runs the agent
 *     loop with the new state. The LLM picks up where the intent
 *     left off.
 *
 * Returning `null` aborts the intent and falls through to the LLM
 * (regex matched but state isn't deterministically resolvable —
 * "Configured Slack" came in but no Slack slot exists in the active
 * plan). Only valid before any `ctx.callTool` has fired; null after
 * a tool call is a programmer error and gets logged + treated as a
 * terminal completion.
 */
export type IntentResult =
  | {readonly _intentResult?: never}
  | {readonly continue: true};

/**
 * One intent definition. Lives at
 * `<repoPath>/intents/<id>/intent.ts` and is the file's default
 * export.
 */
export interface IntentDefinition {
  /** Stable id, used for logs, telemetry, and the directory name. */
  id: string;

  /**
   * Pattern matched against the literal user message. First match
   * across the intent list wins; ordering follows the loader's
   * directory walk (which sorts alphabetically). Anchor your regex
   * (`^...$`) and use precise phrasing — strings the system itself
   * sends ("Set up template 'X'.", "Configured Slack") are good
   * triggers; loose matches on natural-language fragments will
   * surprise users.
   */
  regex: RegExp;

  /**
   * Compose the tool sequence imperatively. Return `{}` to signal
   * a clean completion. Return `null` to abort and fall through to
   * the LLM (regex matched but state isn't right — e.g. "Configured
   * Slack" came in but no Slack slot exists in the active plan).
   * Throwing also aborts but emits an error SSE for the user — use
   * `null` for "this isn't my problem", throw for "it broke".
   */
  handle(ctx: IntentContext): Promise<IntentResult | null>;
}
