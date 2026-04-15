# @amodalai/runtime

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.3
  - @amodalai/core@0.3.3
  - @amodalai/db@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.2
  - @amodalai/core@0.3.2
  - @amodalai/db@0.3.2

## 0.3.1

### Patch Changes

- [#198](https://github.com/amodalai/amodal/pull/198) [`9833d69`](https://github.com/amodalai/amodal/commit/9833d696fb641d08f39fc3296f49a61c04350fe2) Thanks [@gte620v](https://github.com/gte620v)! - Publish `@amodalai/db` to npm. The 0.3.0 release of `@amodalai/runtime` and `@amodalai/amodal` declared a workspace dependency on `@amodalai/db@0.0.0`, which was never published (the package was `private: true`), causing `pnpm add -g @amodalai/amodal` to fail with an `ERR_PNPM_FETCH_404` on `@amodalai/db`. This release unprivate's the package, adds standard publish metadata, and brings it into the fixed version group so it is released in lockstep with the rest of the public packages.

- Updated dependencies [[`9833d69`](https://github.com/amodalai/amodal/commit/9833d696fb641d08f39fc3296f49a61c04350fe2)]:
  - @amodalai/db@0.3.1
  - @amodalai/types@0.3.1
  - @amodalai/core@0.3.1

## 0.3.0

### Minor Changes

- [#194](https://github.com/amodalai/amodal/pull/194) [`13723ff`](https://github.com/amodalai/amodal/commit/13723ff5be1e9983a1a66c697ec352d3a2dbfcd7) Thanks [@gte620v](https://github.com/gte620v)! - Studio standalone: separate Studio into its own Next.js service, strip admin code from runtime, add workspace tools, update CLI to spawn Studio + admin agent subprocesses

- [#194](https://github.com/amodalai/amodal/pull/194) [`13723ff`](https://github.com/amodalai/amodal/commit/13723ff5be1e9983a1a66c697ec352d3a2dbfcd7) Thanks [@gte620v](https://github.com/gte620v)! - Studio admin UI: move all admin/config/stores/automations/evals/feedback to Studio. Runtime-app is now chat + pages only. Postgres required (no PGLite). DATABASE_URL configuration via ~/.amodal/env or agent .env.

### Patch Changes

- Updated dependencies [[`13723ff`](https://github.com/amodalai/amodal/commit/13723ff5be1e9983a1a66c697ec352d3a2dbfcd7), [`13723ff`](https://github.com/amodalai/amodal/commit/13723ff5be1e9983a1a66c697ec352d3a2dbfcd7)]:
  - @amodalai/core@0.3.0
  - @amodalai/types@0.3.0

## 0.2.10

### Patch Changes

- [#192](https://github.com/amodalai/amodal/pull/192) [`8fc217b`](https://github.com/amodalai/amodal/commit/8fc217bebbadb972245e90c066d4410c3d35fed3) Thanks [@whodatdev](https://github.com/whodatdev)! - Add sessionStore option to createServer for hosted session persistence

- Updated dependencies []:
  - @amodalai/types@0.2.10
  - @amodalai/core@0.2.10

## 0.2.9

### Patch Changes

- [#187](https://github.com/amodalai/amodal/pull/187) [`8c7ae14`](https://github.com/amodalai/amodal/commit/8c7ae149dff3167c7dca0f2a26f2401143874090) Thanks [@gte620v](https://github.com/gte620v)! - Add role-gated file access and the foundation for the deploy diff view.

  `/api/files` routes (GET tree, GET file, PUT file) now consult the configured `RoleProvider` and gate access by role:
  - `ops` can read/write anything in the repo (subject to existing path-traversal checks)
  - `admin` can read/write only `skills/`, `knowledge/`, and `agents/` directories. Tree response is filtered to those directories.
  - `user` is denied entirely with 403
  - Unauthenticated requests get 401

  Default behavior in `amodal dev` is unchanged because the default `RoleProvider` returns `ops` for everyone.

  Adds a new `DiffView` React component plus a `computeLineDiff` LCS-based line-diff utility (no new dependencies). The component is ready to render unified diffs but is not yet wired into a backend diff endpoint — that comes in a follow-up PR (`/api/workspace/diff` in the cloud repo).

  The `WorkspaceBar`'s "Persist" button now opens a `DeployConfirmModal` that lists the files about to be deployed. The actual line-by-line diffs will be added once the workspace diff endpoint exists in cloud.

- [#191](https://github.com/amodalai/amodal/pull/191) [`42a3c0b`](https://github.com/amodalai/amodal/commit/42a3c0bf93d420138fe68c39ed0312e1b9b397a1) Thanks [@whodatdev](https://github.com/whodatdev)! - Pass session messages to onSessionPersist hook instead of empty array

- [#185](https://github.com/amodalai/amodal/pull/185) [`0a8dd80`](https://github.com/amodalai/amodal/commit/0a8dd809b52e2790b13c99b423800deabfe8c970) Thanks [@gte620v](https://github.com/gte620v)! - Add RoleProvider interface for role-based access control. Hosting layers (cloud, self-hosted, `amodal dev`) plug in their own implementation to map requests to `user`/`admin`/`ops` roles. Adds `GET /api/me` endpoint and `requireRole` middleware factory. Default provider returns `ops` for all requests so `amodal dev` and existing deployments work unchanged.

- Updated dependencies []:
  - @amodalai/types@0.2.9
  - @amodalai/core@0.2.9

## 0.2.8

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.8
  - @amodalai/core@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.7
  - @amodalai/core@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.6
  - @amodalai/core@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.5
  - @amodalai/core@0.2.5

## 0.2.4

### Patch Changes

- [#174](https://github.com/amodalai/amodal/pull/174) [`0132204`](https://github.com/amodalai/amodal/commit/0132204a35f457e067fc5150a219f264a0f0955c) Thanks [@gte620v](https://github.com/gte620v)! - Add image output support in tool results. Tool call results are now sent to the frontend via SSE. MCP adapter preserves image content blocks instead of discarding them. Google provider extracts Gemini native image parts. Image-aware snipping prevents base64 data from being destroyed by truncation. New ImagePreview component renders image thumbnails in ToolCallCard.

- [#172](https://github.com/amodalai/amodal/pull/172) [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517) Thanks [@gte620v](https://github.com/gte620v)! - Add image paste support to chat

  Users can paste images from the clipboard into the chat input. Images show as removable thumbnails before sending, then render in the user message bubble. Vision-capable providers (Anthropic, Google, OpenAI) receive the image; non-vision providers strip it with a warning. Images are stored in a separate `image_data` column to avoid JSONB bloat, with automatic rehydration on session load.

- Updated dependencies [[`0132204`](https://github.com/amodalai/amodal/commit/0132204a35f457e067fc5150a219f264a0f0955c), [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517)]:
  - @amodalai/core@0.2.4
  - @amodalai/types@0.2.4

## 0.2.3

### Patch Changes

- [#169](https://github.com/amodalai/amodal/pull/169) [`83d0153`](https://github.com/amodalai/amodal/commit/83d01530ae0b85cf7333df75e6fe15cabb1cb63b) Thanks [@whodatdev](https://github.com/whodatdev)! - Add messaging channels to deploy snapshots

- Updated dependencies [[`83d0153`](https://github.com/amodalai/amodal/commit/83d01530ae0b85cf7333df75e6fe15cabb1cb63b)]:
  - @amodalai/types@0.2.3
  - @amodalai/core@0.2.3

## 0.2.2

### Patch Changes

- [#167](https://github.com/amodalai/amodal/pull/167) [`f4d59ea`](https://github.com/amodalai/amodal/commit/f4d59eae060aa5fa35e1f2f756413457a4d5331b) Thanks [@whodatdev](https://github.com/whodatdev)! - Add messaging channel plugin system
  - Channel plugins are npm packages discovered via channel.json, dynamically loaded at boot
  - Webhook router at POST /channels/:channelType/webhook with dedup, rate limiting, session affinity
  - Drizzle and in-memory session mappers for channel user → session mapping
  - ChannelPlugin interface with optional setup() for interactive CLI configuration
  - `amodal connect channel <pkg>` and `amodal connect connection <pkg>` commands
  - ChannelSetupContext for plugin-owned setup flows (prompt, writeEnv, updateConfig)

- [#166](https://github.com/amodalai/amodal/pull/166) [`1523d96`](https://github.com/amodalai/amodal/commit/1523d96f2bb1d6b5e2f0023690f9abb371b88fd3) Thanks [@whodatdev](https://github.com/whodatdev)! - Replace custom package registry with standard npm

  Packages are now standard npm dependencies installed to node_modules/.
  Declare installed packages in amodal.json `packages` array.
  - Remove custom registry, hidden npm context (amodal_packages/), and lock file (amodal.lock)
  - Add package-manager.ts (detectPackageManager, pmAdd, pmRemove, ensurePackageJson)
  - Resolver loads declared packages using same nested structure as local repo
  - amodal install/uninstall manage both npm deps and amodal.json packages array
  - Remove publish, search, diff, update, list commands (use npm directly)
  - Admin agent fetches from npmjs.org

- [#162](https://github.com/amodalai/amodal/pull/162) [`a33e080`](https://github.com/amodalai/amodal/commit/a33e0807e6607c88aa203f5dd2c1bf89299026d8) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove userId, userRoles, and userContext from the OSS runtime

  The local runtime is single-tenant with no user system. Role-based access
  control is now the responsibility of the hosting layer via the new
  `onSessionBuild` hook on `CreateServerOptions`.
  - Removed `userRoles` from FieldScrubber, OutputGuard, Session, AgentContext, ToolContext
  - Removed `userContext` from AmodalConfig
  - Removed `role` from chat request schema and React client
  - Simplified `role_gated` policy to always deny (same as `never_retrieve`)
  - Deleted PreferenceClient, ScopeChecker, user-context-fetcher
  - Added `onSessionBuild` hook for hosting layer to enhance session components

- Updated dependencies [[`024207b`](https://github.com/amodalai/amodal/commit/024207b91220acfc9e44a73499dfd64124f54ab0), [`f4d59ea`](https://github.com/amodalai/amodal/commit/f4d59eae060aa5fa35e1f2f756413457a4d5331b), [`1523d96`](https://github.com/amodalai/amodal/commit/1523d96f2bb1d6b5e2f0023690f9abb371b88fd3), [`a33e080`](https://github.com/amodalai/amodal/commit/a33e0807e6607c88aa203f5dd2c1bf89299026d8)]:
  - @amodalai/core@0.2.2
  - @amodalai/types@0.2.2

## 0.2.1

### Patch Changes

- [#156](https://github.com/amodalai/amodal/pull/156) [`80cfcfc`](https://github.com/amodalai/amodal/commit/80cfcfc63e8f67e80585f416ce3abdfdde0c966f) Thanks [@gte620v](https://github.com/gte620v)! - Restore admin file-discovery tools that went missing after the SDK swap.

  The admin agent had `read_repo_file`, `write_repo_file`, `delete_repo_file`
  and `internal_api` but no way to **enumerate** what files exist — it spent
  turns guessing paths (`skills/content-analysis/SKILL.md`, `agents/main.md`)
  and often failing. This adds five new admin file tools, all sharing the
  same allowed-directory allowlist:
  - `list_repo_files` — list files in an allowed directory (or every
    allowlist dir at once). Recursive by default. Skips `.git`,
    `node_modules`, `.DS_Store`. Capped at 2000 entries with a
    `truncated: true` signal.
  - `glob_repo_files` — glob pattern match (`**/SKILL.md`, `skills/**/*.md`)
    with recent-first sort (24h-touched files surfaced first). Capped at 500.
  - `grep_repo_files` — regex content search across the allowlist. Optional
    `dir` filter, `include` glob, case-insensitivity default. Capped at 100
    matches (matches gemini-cli's `DEFAULT_TOTAL_MAX_MATCHES`).
  - `edit_repo_file` — find-and-replace edit in place. Default requires
    exactly-one-occurrence (fails safely on ambiguous edits); set
    `allow_multiple: true` to replace every match. Saves context tokens
    vs full-rewrite `write_repo_file`.
  - `read_many_repo_files` — batched read of multiple files. Capped at
    20 files × 50KB each.

  Also fixes the confusing `Path "skills" is not in an allowed directory`
  error from `read_repo_file`/`write_repo_file`/`delete_repo_file` when
  passed a bare allowlist directory name — they now emit a directed error
  pointing at `list_repo_files`:

      Path "skills" is a directory — use list_repo_files to enumerate its
      contents, or provide a file path like "skills/<name>".

  **Dead code removed:**
  - `packages/runtime/src/session/admin-file-tools.ts` (superseded by
    `packages/runtime/src/tools/admin-file-tools.ts` in the SDK swap,
    never deleted, zero imports).
  - `packages/core/src/tools/definitions/amodal-tools.ts` plus
    `getProposeKnowledgeDefinition`/`getPresentToolDefinition`/
    `getRequestToolDefinition` exports from `@amodalai/core` — the
    underlying `propose_knowledge` tool was deleted in [#144](https://github.com/amodalai/amodal/issues/144), leaving
    these as stale definitions for a non-existent tool.

- [#149](https://github.com/amodalai/amodal/pull/149) [`3ab8e19`](https://github.com/amodalai/amodal/commit/3ab8e19130ad6458171f2e3605bf6dc6be1bce6d) Thanks [@gte620v](https://github.com/gte620v)! - Agent loop safety and quality features:
  - **Token budget enforcement.** `AgentContext` gains an optional `maxTokens` cap; `runAgent()` checks `usage.totalTokens` between state transitions and terminates with `DoneReason: 'budget_exceeded'` when the cap is hit. Closes the silent-cost-runaway hole where a long-running automation could burn through tokens in a tight retry loop. Sub-agent dispatches inherit the parent's remaining budget. The `DoneReason` is now surfaced on the SSE `done` event so consumers can distinguish normal termination from enforced caps.
  - **Generalized tool confirmation.** `ToolDefinition` gains a `requiresConfirmation` flag that routes any flagged tool through the existing `CONFIRMING` state, not just connection tools. Approvals are tracked per-session via `ctx.confirmedCallIds`, which also fixes a latent infinite-loop bug in the connection-tool confirmation path where a re-check after approval would re-route back to CONFIRMING.
  - **Tool result summarization hook.** `AgentContext.summarizeToolResult` is a new optional hook (wired through `SessionManager.runMessage` opts); when set, context-evicted tool results are replaced with a 1-2 sentence LLM-generated summary instead of the generic `[Tool result cleared]` marker. Bounded by a 5-second timeout, idempotent across turns, and degrades to the static marker on summarizer failure. Also fixes three latent bugs in `clearOldToolResults`: orphaned tool-calls (cleared markers now preserve the original `toolCallId`/`toolName` so providers don't reject the conversation), cleared state not persisted (ctx.messages is now written back so the hook isn't called repeatedly for the same messages), and already-cleared detection (by output-value prefix now that the callId is preserved).
  - **Provider-native token counting.** `LLMProvider` gains an optional `countTokens(messages)` method; `estimateTokenCount()` delegates to it when implemented, falling back to the 4-chars-per-token heuristic otherwise. Unlocks accurate compaction boundaries as providers wire native tokenizers.
  - **Loop detection escalation tier.** New `loopEscalationThreshold` (default 5) sits between the warning threshold (3) and the hard-stop (8). When hit, the loop emits a stronger system message and removes the looping tool from the tool set for that turn, forcing the agent to try a different approach.

- [#152](https://github.com/amodalai/amodal/pull/152) [`745228d`](https://github.com/amodalai/amodal/commit/745228db110b6da50e0514f6dc90250037ada958) Thanks [@gte620v](https://github.com/gte620v)! - Add delivery routing for automations.

  Automations can now declare where their results go when they complete, and
  where failure alerts go when they fail repeatedly. Targets can be webhooks,
  ISV-provided callbacks, or multiple of each in parallel.

  ```json
  {
    "name": "scan-trending",
    "schedule": "0 */4 * * *",
    "prompt": "Scan for trending AI content",
    "delivery": {
      "targets": [
        { "type": "webhook", "url": "env:SLACK_WEBHOOK_URL" },
        { "type": "callback" }
      ],
      "template": "Found {{count}} new articles. Top: {{top_title}}"
    },
    "failureAlert": {
      "after": 3,
      "targets": [{ "type": "webhook", "url": "env:ALERT_WEBHOOK_URL" }],
      "cooldownMinutes": 60
    }
  }
  ```

  Features:
  - **Multiple targets in parallel.** Each target is dispatched concurrently.
  - **Template rendering** with `{{variable}}` substitution. Variables come from
    the automation's parsed JSON result (top-level keys) plus built-ins
    `{{automation}}`, `{{timestamp}}`, `{{result}}`. Missing variables stay as
    literal tokens and emit a `delivery_template_missing_var` log warning (once
    per automation+template+missing-key combo) so prompt drift is diagnosable.
    Template output is plain text — receivers that interpret markdown (Slack,
    GitHub) will render any markdown/tag syntax present in agent output.
  - **ISV callback targets** via `createLocalServer({ onAutomationResult })` —
    receive the full delivery payload plus target metadata (including the
    optional `name` field) so ISVs can distinguish between multiple callback
    targets on the same automation. Signature: `(payload, target) => void`.
  - **Failure alerting** with consecutive-failure tracking per automation, a
    configurable `after` threshold, and a `cooldownMinutes` window to prevent
    alert spam during sustained outages. Counter resets on success. Note:
    failure state is in-memory per process; restart resets counters and
    cooldown windows.
  - **Webhook retry** on transient failures — one retry with 1s delay on 5xx
    responses and network errors. 4xx responses do not retry.
  - **HMAC signing** on webhook deliveries when `webhookSecret` is configured.
    Receivers verify with: `expected = "sha256=" + hmac_sha256(secret, body)`
    against the `X-Amodal-Signature` header. Use constant-time comparison.
  - **Result truncation** at 16KB — long agent outputs are truncated (head+tail
    preserved around an elision marker) with `truncated: true` on the payload,
    so receivers with size caps (Slack 4KB, GitHub 64KB) aren't silently
    dropped. Templates receive the full untruncated text.
  - **env:NAME resolution** on webhook URLs happens at bundle-load time (in
    `bridgeAutomation`), so missing env vars fail fast at server boot with a
    `RepoError` — not at first delivery attempt. URLs are validated at parse
    time to require `http://`, `https://`, or `env:` prefix.
  - **Observability via event bus** — each delivery emits a `delivery_succeeded`
    or `delivery_failed` event with automation name, target type/url, HTTP
    status, duration, and retry attempt count, so operators can answer "which
    deliveries failed in the last hour?" without grepping logs.

  Backward compatible: automations without `delivery` or `failureAlert` fields
  run exactly as before. The `onAutomationResult` callback signature changed
  to `(payload, target)` — ISVs calling this will need to accept the second
  argument.

  New public types: `DeliveryTarget`, `DeliveryConfig`, `FailureAlertConfig`,
  `DeliveryPayload` in `@amodalai/types`. New event types:
  `DeliverySucceededEvent`, `DeliveryFailedEvent`.

- [#148](https://github.com/amodalai/amodal/pull/148) [`cdcf62f`](https://github.com/amodalai/amodal/commit/cdcf62f90f42a3a6064f7e86cdcfa0293493e949) Thanks [@gte620v](https://github.com/gte620v)! - Add runtime event bus for push-based UI updates.

  The runtime now emits typed lifecycle events (session_created/updated/deleted,
  automation_triggered/completed/failed, manifest_changed, files_changed) on an
  internal `RuntimeEventBus`. Events are streamed to clients over a new
  `/api/events` SSE endpoint.

  Clients connect once via EventSource and receive every state change in real
  time. Replaces `setInterval` polling in the runtime-app for session list,
  automation status, manifest reloads, file tree, and health checks. The UI now
  updates the instant something changes instead of on 3-10 second cycles.

  The bus buffers the last 200 events and supports `Last-Event-ID` for
  reconnect-and-resume, so clients never miss state changes across brief
  disconnects.

  New public types: `RuntimeEvent`, `RuntimeEventType`, `RuntimeEventPayload`.

- [#161](https://github.com/amodalai/amodal/pull/161) [`46f7c4a`](https://github.com/amodalai/amodal/commit/46f7c4a65478b0ee4a0115fde5415f65a760af16) Thanks [@gte620v](https://github.com/gte620v)! - Fix Anthropic provider-key verification at `amodal dev` startup.
  The check was hitting `GET /v1/messages`, which Anthropic rejects
  with HTTP 405 (Method Not Allowed) before it even looks at the
  `x-api-key` header — so every key, valid or bogus, showed up as
  `provider_key_invalid`. Switch to `GET /v1/models`, which returns
  200 on valid keys and 401 on bad ones.

- [#155](https://github.com/amodalai/amodal/pull/155) [`5ea8f5e`](https://github.com/amodalai/amodal/commit/5ea8f5ed89000d7cef7e57e7cc56e64b1bc6191b) Thanks [@gte620v](https://github.com/gte620v)! - Fix process crash when an SSE client disconnects mid-stream.

  When a browser tab reloads, navigates away, or otherwise drops an in-flight
  SSE connection, the route's `res.on('close', () => controller.abort())`
  handler fires `ctx.signal.abort()`. Inside the agent loop, the provider's
  `streamText()` returns a `StreamTextResult` with three separate promises
  (`fullStream`, `text`, `usage`) that share the same upstream fetch. When
  the fetch aborts, all three reject.

  `handleStreaming` iterates `fullStream` first and only awaits `text`/`usage`
  after the loop completes. If the loop throws due to abort, the derived
  promises were never awaited and Node surfaces them as unhandled promise
  rejections, crashing the process.

  The fix attaches passive `.catch(() => {})` handlers to `state.stream.text`
  and `state.stream.usage` at the top of `handleStreaming`, before entering
  the for-await loop. The real error still surfaces via the thrown stream
  error that propagates up to the route's try/catch; the suppressed handlers
  only prevent an abort-induced rejection from escaping as unhandled.

  This was most visible in the admin-chat route (browser auto-reloads on
  `config_reloaded` events triggered by `write_repo_file` tool calls), but
  affects every streaming chat route equally.

- [#160](https://github.com/amodalai/amodal/pull/160) [`efedd6a`](https://github.com/amodalai/amodal/commit/efedd6ad75fdc420ef602fba45fc1992e884ee3a) Thanks [@gte620v](https://github.com/gte620v)! - Run read-only tool calls concurrently within a turn.

  The EXECUTING state handler now batches contiguous leading read-only,
  non-confirmation, non-connection tool calls from the queue and runs them
  via `Promise.all`. Writes, confirmation-gated tools, connection-ACL tools,
  and `dispatch_task` still flow through the single-call path for
  correctness.

  **What changes:** when a model emits multiple parallel tool calls per
  turn, independent reads (store reads, knowledge lookups, search/fetch,
  etc.) return in one `max(tool_duration)` instead of `sum(tool_duration)`.
  This also collapses N EXECUTING transitions into one, cutting
  state-machine overhead.

  **What stays the same:** sanitize/log behavior, SSE event shape (per-call
  ToolCallStart + ToolCallResult events still fire for every call in batch
  order), result-message ordering in the conversation history, pre-execution
  cache (still honored per-call inside the batch), smart-snipping on
  oversized results, and compaction threshold checks after the queue drains.

  **Why it's safe:** tools declared `readOnly: true` have no external
  side-effects that depend on ordering, so running them in parallel can't
  change outcomes. Connection tools and tools flagged `requiresConfirmation`
  are explicitly excluded because their gates must evaluate per-call.

- [#151](https://github.com/amodalai/amodal/pull/151) [`901d606`](https://github.com/amodalai/amodal/commit/901d6065c5e4c7e5c3038757aeb476d352eb4335) Thanks [@gte620v](https://github.com/gte620v)! - Add `PostgresSessionStore` for production session persistence.

  Completes the "no PGLite in production" story started in [#146](https://github.com/amodalai/amodal/issues/146). Any ISV
  embedding `@amodalai/runtime` can now point session persistence at a
  real Postgres database by setting `stores.backend: 'postgres'` and
  `stores.postgresUrl` in `amodal.json`. PGLite remains the default for
  `amodal dev` — zero config unchanged.

  **New surface:**
  - `PostgresSessionStore` class and `createPostgresSessionStore()` factory
    (accepts either a `connectionString` or an existing `pg.Pool`).
  - `SessionStoreHooks` — optional `onAfterSave` / `onAfterDelete` /
    `onAfterCleanup` callbacks, awaited on the write path. Intended for
    dual-write, observability, or cache invalidation.
  - `SessionListOptions` — cursor pagination, metadata JSONB filters,
    `updatedAfter` / `updatedBefore` date range.
  - `SessionStoreError` typed error for module-boundary failures.
  - `selectSessionStore()` helper used by `local-server.ts` to pick the
    backend. Falls back to PGLite if `postgres` is configured but the URL
    is missing — the session store must always be available.

  **Interface change:** `SessionStore.list()` now returns
  `{sessions, nextCursor}` instead of `PersistedSession[]`. Internal only —
  not publicly exported via `@amodalai/runtime`.

- [#157](https://github.com/amodalai/amodal/pull/157) [`bf907d4`](https://github.com/amodalai/amodal/commit/bf907d4f083fa000a246de1a749548a86dc2e3bf) Thanks [@gte620v](https://github.com/gte620v)! - Add line-range pagination to `read_repo_file` so long files don't blow the
  agent's context window on a single call.

  Matches the conventions of Claude Code's `Read` tool and gemini-cli's
  `read_file`: by default a read returns the first 2000 lines and tells the
  agent how many more there are, so the agent can paginate only when it
  actually needs the rest.

  **New parameters on `read_repo_file`:**
  - `offset` (1-indexed, default `1`) — the line number to start reading from
  - `limit` (default 2000, max 10000) — how many lines to return

  **New response fields on `read_repo_file`:**
  - `line_start`, `line_end` — the 1-indexed range actually returned
  - `total_lines` — how many lines the file has
  - `truncated: true` — present when `line_end < total_lines`; agent should
    call again with `offset: line_end + 1` to continue

  Before this change, `read_repo_file` returned the entire file regardless
  of size. A 50KB connection spec or 2000-line lockfile would land in the
  agent's next prompt verbatim, eating context budget for no reason. With
  pagination the default read is bounded and the agent has the metadata it
  needs to ask for more.

  Also:
  - `read_repo_file` now rejects binary files (NUL-byte heuristic) instead
    of returning mojibake.
  - `read_many_repo_files` now reports `total_lines` for each file in the
    response, so when byte-based truncation fires the agent knows whether
    to switch to the paginated `read_repo_file` for the full content.
  - New exported constants: `READ_FILE_DEFAULT_LINES`, `READ_FILE_MAX_LINES`.
  - **Loop detector now skips pagination variants.** Previously the detector
    counted calls as "similar" when ≥50% of their values matched — which
    flagged legitimate multi-chunk pagination (same tool, same path, three
    different `offset` values: 67% matching) as a loop after 3 calls. The
    heuristic now treats known iteration keys (`offset`, `limit`, `page`,
    `cursor`, `start_line`/`end_line`, `after`/`before`, etc.) as
    pagination, not loop-defining — two calls that differ ONLY in those
    keys no longer count toward loop detection.

- [#154](https://github.com/amodalai/amodal/pull/154) [`7811174`](https://github.com/amodalai/amodal/commit/781117447532ed3bf513ce776b39e86d16220f90) Thanks [@gte620v](https://github.com/gte620v)! - Remove `tenantId` and `userId` from sessions, tool context, and session store.

  Both fields were vestigial — carried through every layer but never used
  for any authorization, scoping, or product decision. Default values
  were hard-coded placeholders (`'local'`, `'admin'`, `'snapshot'`,
  `'automation'`, `'api'`, `'anonymous'`) that had no relationship to
  real identities.

  Consumers needing tenant or user scoping should:
  - Namespace session IDs directly (e.g. `tenant-a:session-123`)
  - Stamp scope into `metadata` JSONB and filter via `list({filter})`
  - Use `userRoles` (still present, still drives connection ACLs)

  **API changes:**
  - `Agent.createSession()` no longer accepts `tenantId` / `userId` options
  - `ToolContext` drops `tenantId` field — tools reading `ctx.tenantId`
    must be updated
  - `PersistedSession`, `Session`, `CreateSessionOptions` all drop both
    fields
  - `SessionStore.load(sessionId)` — was `load(tenantId, sessionId)`
  - `SessionStore.delete(sessionId)` — was `delete(tenantId, sessionId)`
  - `SessionStore.list(opts)` — was `list(tenantId, opts)`
  - `StandaloneSessionManager.listPersisted(opts)` — was
    `listPersisted(tenantId, opts)`
  - `AuthContext` drops unused `orgId` and `actor` fields

  **Schema change:**
  - `agent_sessions` table drops `tenant_id` and `user_id` columns
  - Index `idx_agent_sessions_tenant` replaced with
    `idx_agent_sessions_updated`
  - **Existing deployments must drop these columns** before running this
    version, or roll back persisted sessions. The columns are no longer
    written to or read from.

- [#153](https://github.com/amodalai/amodal/pull/153) [`5104a17`](https://github.com/amodalai/amodal/commit/5104a17315f9072a79e6f668bfff3d3f2473a330) Thanks [@gte620v](https://github.com/gte620v)! - Retire the legacy file-based `SessionStore` (`.amodal/sessions/*.json`).

  The dev-UI session history routes in `local-server.ts` (`GET /sessions`,
  `GET /session/:id`, `PATCH /session/:id`, `DELETE /session/:id`, and
  `resumeSessionId: 'latest'`) now read and write through the
  `DrizzleSessionStore` that was already handling session resume. This
  removes the dual-persistence path that held overlapping data in two
  stores.

  **Behavioural changes:**
  - Chat sessions no longer write to `.amodal/sessions/` — they only land
    in PGLite (or Postgres). The dev UI reads from the same store.
  - Session metadata now carries `appId` so list queries can filter out
    eval-runner / admin sessions via `metadata.appId = 'local'`.
  - Automation session history is tagged via `metadata.automationName`
    (set in the proactive-runner `onSessionComplete` hook), preserving
    the `/sessions?automation=<name>` filter used by the automation
    detail page.
  - Session titles (set via `PATCH /session/:id`) live on
    `metadata.title` and persist through `sessionManager.persist()`.

  Existing `.amodal/sessions/*.json` files are orphaned and can be
  deleted — they are no longer read.

- [#163](https://github.com/amodalai/amodal/pull/163) [`7d6e825`](https://github.com/amodalai/amodal/commit/7d6e8257b790380ca599c8cb1a0d937bb3741dd1) Thanks [@gte620v](https://github.com/gte620v)! - Unify chat-stream plumbing behind a single canonical `useChatStream`
  hook. Both `useChat` and `useAmodalChat` now delegate to it, and the
  admin chat in the runtime app gets tool-call callouts for free — it
  previously rolled its own SSE parser that silently dropped every
  event type except `init`, `text_delta`, and `error`.

  `useChatStream` owns the reducer, the SSE → action mapping, and the
  widget event bus. Consumers inject transport via a `streamFn` option:

  ```ts
  const stream = useChatStream({
    streamFn: (text, signal) =>
      streamSSE("/my/endpoint", { message: text }, { signal }),
    onToolCall: (call) => console.log("tool finished:", call),
  });
  ```

  The public API of `useChat` and `useAmodalChat` is unchanged — the
  refactor is internal. No behavior changes for existing consumers
  beyond a few previously-missing fixes that are now in the canonical
  reducer (e.g. `parameters` fallback on `tool_call_result`, usage
  accumulation on `done`).

  New exports from `@amodalai/react`:
  - `useChatStream`, `UseChatStreamOptions`, `UseChatStreamReturn`
  - `chatReducer` (re-exported from the canonical location)

- [#158](https://github.com/amodalai/amodal/pull/158) [`57b143f`](https://github.com/amodalai/amodal/commit/57b143fac3c0de23651dd26a295be9ee553a91d1) Thanks [@gte620v](https://github.com/gte620v)! - Add built-in `web_search` and `fetch_url` tools backed by Gemini Flash
  grounding. Enabled when `webTools` is configured in `amodal.json` with
  a Google API key:

  ```json
  {
    "webTools": {
      "provider": "google",
      "apiKey": "env:GOOGLE_API_KEY",
      "model": "gemini-3-flash-preview"
    }
  }
  ```

  `web_search` returns a synthesized answer with cited source URLs.
  `fetch_url` returns page content as markdown — Gemini `urlContext` is
  the primary path, with a local `fetch()` + Mozilla Readability fallback
  for private-network URLs (localhost, RFC1918) or Gemini failures. Both
  tools are registered automatically on every session when `webTools` is
  present. Per-hostname rate limiting (10 req / 60s) and a 2000-token
  cap apply to both tools.

- Updated dependencies [[`80cfcfc`](https://github.com/amodalai/amodal/commit/80cfcfc63e8f67e80585f416ce3abdfdde0c966f), [`745228d`](https://github.com/amodalai/amodal/commit/745228db110b6da50e0514f6dc90250037ada958), [`cdcf62f`](https://github.com/amodalai/amodal/commit/cdcf62f90f42a3a6064f7e86cdcfa0293493e949), [`57b143f`](https://github.com/amodalai/amodal/commit/57b143fac3c0de23651dd26a295be9ee553a91d1)]:
  - @amodalai/core@0.2.1
  - @amodalai/types@0.2.1

## 0.2.0

### Minor Changes

- [#123](https://github.com/amodalai/amodal/pull/123) [`95492b6`](https://github.com/amodalai/amodal/commit/95492b611e5626a22d0dd782ca91e18750ac0f0e) Thanks [@gte620v](https://github.com/gte620v)! - Add provider failover chain for the LLMProvider interface (Phase 1.4)

### Patch Changes

- [#128](https://github.com/amodalai/amodal/pull/128) [`dcb5094`](https://github.com/amodalai/amodal/commit/dcb5094fa382ef47b33fbe1bc8a36c31084ef654) Thanks [@gte620v](https://github.com/gte620v)! - Rewrite admin file tools (read/write/delete repo file, internal API) with Zod schemas for the new ToolRegistry. Preserves path validation and directory restrictions.

- [#139](https://github.com/amodalai/amodal/pull/139) [`4c3d572`](https://github.com/amodalai/amodal/commit/4c3d5722e263bf6dda2dba93f29427d06615fbd3) Thanks [@gte620v](https://github.com/gte620v)! - Rewrite chat routes to use StandaloneSessionManager (Phase 3.5c)
  - New `chat-stream.ts`, `ai-stream.ts`, `chat.ts` routes use `StandaloneSessionManager` + `buildSessionComponents()` instead of the legacy `SessionManager`
  - New `session-resolver.ts` extracts shared session resolution logic (bundle resolution, session lookup/resume/create)
  - Add hydration deduplication to `StandaloneSessionManager.resume()` via `pendingResumes` map
  - Legacy route files preserved as `*-legacy.ts` for `server.ts`/`local-server.ts`/`snapshot-server.ts` until Phase 3.5e rewrites the server lifecycle
  - Export `StandaloneSessionManager`, `resolveSession`, `resolveBundle`, `BundleResolver`, `SharedResources` from runtime package

- [#134](https://github.com/amodalai/amodal/pull/134) [`8ebccd3`](https://github.com/amodalai/amodal/commit/8ebccd30eacf3d97ea28c4c5199a862361918cd2) Thanks [@gte620v](https://github.com/gte620v)! - Implement Phase 3.3: context compaction, smart snipping, and loop detection upgrade.

  **Compaction**: COMPACTING state now summarizes older conversation turns via
  generateText with a structured handoff prompt (current state, original task,
  key data, actions taken, errors, next steps). Keeps last 6 turns verbatim.
  Circuit breaker trips after 3 consecutive failures — continues without
  compaction rather than crashing.

  **Smart snipping**: Tool results exceeding 20K chars are snipped to keep the
  first and last 2K chars with a [snipped] marker. Replaces the blunt 40K hard
  truncation from Phase 3.1.

  **Loop detection upgrade**: Now checks parameter similarity, not just tool name
  frequency. Calls with the same keys and >50% identical values are grouped as
  similar, catching retry loops where only one parameter changes.

  **SSE events**: Adds `compaction_start` and `compaction_end` events so the UI
  can show compaction status and token savings.

- [#125](https://github.com/amodalai/amodal/pull/125) [`cf08296`](https://github.com/amodalai/amodal/commit/cf08296efbe1655125dc8b4059bdf426ef324ee1) Thanks [@gte620v](https://github.com/gte620v)! - Extract PermissionChecker interface and rewrite request tool with Zod schemas for the new ToolRegistry. Includes AccessJsonPermissionChecker wrapping ActionGate with intent/method validation, delegation, and threshold escalation.

- [#133](https://github.com/amodalai/amodal/pull/133) [`baa667d`](https://github.com/amodalai/amodal/commit/baa667d4dd783a105516d0c82b68c7c660dd2611) Thanks [@gte620v](https://github.com/gte620v)! - Add standalone context compiler (Phase 3.2)

  Extracts system prompt compilation into `packages/runtime/src/context/compiler.ts` — a single module that takes raw agent config (connections, skills, knowledge, stores) and produces the complete system prompt. Handles field guidance generation, scope label resolution, alternative lookup guidance, and store schema rendering internally. Replaces the scattered `buildDefaultPrompt()` assembly logic in session-manager and inspect routes.

- [#126](https://github.com/amodalai/amodal/pull/126) [`60076b0`](https://github.com/amodalai/amodal/commit/60076b056cba9cf967d99b49d767391561e06573) Thanks [@gte620v](https://github.com/gte620v)! - Add custom tool adapter for new ToolRegistry (Phase 2.4). Converts LoadedTool instances to ToolDefinition objects using AI SDK jsonSchema() for proper LLM parameter schemas, typed errors, and full CustomToolContext (request, store, exec, env, log).

- [#127](https://github.com/amodalai/amodal/pull/127) [`ea3bd16`](https://github.com/amodalai/amodal/commit/ea3bd166b79f900a4f5e941cf77fe8dcaf1ae638) Thanks [@gte620v](https://github.com/gte620v)! - Add MCP tool adapter to convert discovered tools to Zod-based ToolDefinitions (Phase 2.5)

- [#141](https://github.com/amodalai/amodal/pull/141) [`db615b2`](https://github.com/amodalai/amodal/commit/db615b2f30ee91381c9b538b2c6c71606964b8b5) Thanks [@gte620v](https://github.com/gte620v)! - Complete SDK swap: admin/automation/eval swap, server lifecycle rewrite, delete old code (Phase 3.5d+e+f)

- [#144](https://github.com/amodalai/amodal/pull/144) [`42d1947`](https://github.com/amodalai/amodal/commit/42d194773515d196992cf9586819333b64d6187e) Thanks [@gte620v](https://github.com/gte620v)! - Remove gemini-cli-core dependency and add public createAgent() API (Phase 4.1 + 4.2)

- [#146](https://github.com/amodalai/amodal/pull/146) [`21fa374`](https://github.com/amodalai/amodal/commit/21fa374bc69e3219123735a990545cb1399165c4) Thanks [@gte620v](https://github.com/gte620v)! - Migrate PGLite store backend to Drizzle ORM and add Postgres backend (Phase 4.3b)

  The PGLite store backend is now implemented on top of Drizzle ORM instead of raw SQL. A new Postgres backend (`createPostgresStoreBackend`) shares the same query layer and schema, enabling hosted runtimes to swap backends without changing behaviour. Both backends share `storeDocuments` and `storeDocumentVersions` tables defined in the shared Drizzle schema. Store-backend errors now throw typed `StoreError` instances instead of being swallowed and returned as `null`/empty results.

- [#147](https://github.com/amodalai/amodal/pull/147) [`4678842`](https://github.com/amodalai/amodal/commit/4678842c361e87baaef0eefe2745a9348ad34377) Thanks [@gte620v](https://github.com/gte620v)! - Pre-release fixes for 0.2.0:
  - Fix chat sessions not appearing in `/sessions` endpoint. The `onSessionPersist`
    stream hook now mirrors the session to the legacy file-based `SessionStore`
    (read by the UI history panel) alongside the PGLite write. Mirror write is
    wrapped in try/catch with `log.warn` — PGLite remains the source of truth,
    so a mirror failure doesn't break the route after the response has drained.
  - Fix `buildPages()` crashing on relative `repoPath`. The generated wrapper
    `.tsx` lives in `.amodal/pages-build/` and imports the page entry by path;
    esbuild can't resolve that import if the path is relative. Now resolves
    to absolute at the top of the function.
  - Forward `ConfirmationRequired`, `CompactionStart`/`End`, and `ToolLog` SSE
    events to the AI SDK UI stream as `data-*` events. Previously dropped.
    Remaining event types (explore, plan mode, field scrub) are explicitly
    dropped; the switch is now exhaustive.
  - Wrap all 20 async Express route handlers with `asyncHandler()` so rejected
    promises propagate to the error middleware instead of hanging the request.
    New `asyncHandler` helper in `routes/route-helpers.ts`.

- [#119](https://github.com/amodalai/amodal/pull/119) [`756c452`](https://github.com/amodalai/amodal/commit/756c452c8da34647c02ab66dd5816207003c97e3) Thanks [@gte620v](https://github.com/gte620v)! - Add Vercel AI SDK v6 dependencies (ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google) and LLMProvider abstraction with createProvider() factory. Includes content generator bridge specification for Phase 1.3.

- [#130](https://github.com/amodalai/amodal/pull/130) [`fa5136e`](https://github.com/amodalai/amodal/commit/fa5136e5f18e9579be7ed6e34d6b296ee2fbd5a2) Thanks [@gte620v](https://github.com/gte620v)! - Remove all `as never` casts from tool registration in session-manager (Phase 2.7)

- [#137](https://github.com/amodalai/amodal/pull/137) [`0667c26`](https://github.com/amodalai/amodal/commit/0667c265b113e9f4b59ae214a84dfe492370edf3) Thanks [@gte620v](https://github.com/gte620v)! - Add tool context factory and session builder (Phase 3.5a + 3.5b)

- [#135](https://github.com/amodalai/amodal/pull/135) [`4e8dde3`](https://github.com/amodalai/amodal/commit/4e8dde3678457974e08f3bf21405525f6fa322c1) Thanks [@gte620v](https://github.com/gte620v)! - Add standalone session manager with Drizzle-backed PGLite persistence, versioned sessions, and onUsage hook on AgentContext

- [#145](https://github.com/amodalai/amodal/pull/145) [`1b8c30a`](https://github.com/amodalai/amodal/commit/1b8c30a687b245e15dbb01bdced605e43e454e1a) Thanks [@gte620v](https://github.com/gte620v)! - Fix tool discoverability and PGLite startup crash
  - **System prompt tool name mismatch:** `compiler.ts` told the LLM to use `write_<store>`, `batch_<store>`, `query_stores` but the actual registered tool names are `store_<store>`, `store_<store>_batch`, `query_store`. Fixed the prompt to match the registered names.
  - **Improved store tool descriptions:** more actionable text, plus `.describe()` on `query_store` Zod params so the LLM sees field-level guidance.
  - **PGLite lock file clash:** `local-server.ts` wrote `server.lock` INSIDE the data dir, which PostgreSQL treats as a corrupted `postmaster.pid` and crashes with `exit(1)`. Moved to `${dataDir}.lock` (sibling path).
  - **Smoke test coverage:** added 16 tests for pages, sessions, files, webhooks, stores REST, and feedback endpoints.

- [#142](https://github.com/amodalai/amodal/pull/142) [`c2d02c5`](https://github.com/amodalai/amodal/commit/c2d02c5447a203652fd1cb338f58c28e643654e2) Thanks [@gte620v](https://github.com/gte620v)! - Add end-to-end smoke tests with self-contained test agent and mock servers

- [#132](https://github.com/amodalai/amodal/pull/132) [`360f9cd`](https://github.com/amodalai/amodal/commit/360f9cd70e004ca7a6bd0db70b31ba60715bb66e) Thanks [@gte620v](https://github.com/gte620v)! - Add agent loop state machine (Phase 3.1). Implements `runAgent()` async generator with discriminated union states (thinking, streaming, executing, confirming, compacting, dispatching, done) and exhaustive transition dispatch. Includes tool pre-execution for read-only tools, parameter sanitization, abort handling, turn budget enforcement, and SSE event emission. Compacting and dispatching states are stubs for Phase 3.3+.

- [#124](https://github.com/amodalai/amodal/pull/124) [`77b41db`](https://github.com/amodalai/amodal/commit/77b41db64dc4b030ee774eaaf80d02fc222de5b0) Thanks [@gte620v](https://github.com/gte620v)! - Rewrite store tools (write, batch, query) with Zod schemas for the new ToolRegistry. Includes registerStoreTools() helper and 15 unit tests.

- [#143](https://github.com/amodalai/amodal/pull/143) [`4a7b781`](https://github.com/amodalai/amodal/commit/4a7b781279f0a15a222c9d40079e18965b437072) Thanks [@gte620v](https://github.com/gte620v)! - Implement sub-agent dispatch (Phase 3.6)
  - New `dispatch_task` tool: Zod-validated schema for delegating sub-tasks to child agents with a subset of tools
  - DISPATCHING state handler: runs child `runAgent()` loop, wraps child events as `SSESubagentEvent` effects, merges child usage into parent
  - EXECUTING state handler intercepts `dispatch_task` by name and transitions to DISPATCHING (avoids circular dependency)
  - Child tools automatically exclude `dispatch_task` to prevent infinite recursion
  - Child maxTurns defaults to 10 (budget-capped)
  - Registered as system tool in session-builder alongside present and stop_execution

- [#136](https://github.com/amodalai/amodal/pull/136) [`2fa8f2a`](https://github.com/amodalai/amodal/commit/2fa8f2a859fc7bb1dd632a26d933b4d4c1136185) Thanks [@gte620v](https://github.com/gte620v)! - Add tool context factory (Phase 3.5a)

  Creates `createToolContextFactory()` in `packages/runtime/src/session/tool-context-factory.ts` — the bridge between the Phase 3 agent loop and Phase 2 tool implementations. Wires `ctx.request()` to connection HTTP calls with auth headers, `ctx.store()` to store backend with key resolution, `ctx.env()` with allowlist, and `ctx.log()` to structured logger. Replaces the legacy `buildToolContext()` that depended on `AgentSession`.

- [#121](https://github.com/amodalai/amodal/pull/121) [`eb24402`](https://github.com/amodalai/amodal/commit/eb24402b712f637f791035aa18113c096c99a452) Thanks [@gte620v](https://github.com/gte620v)! - Add new ToolRegistry with Zod-based ToolDefinition, readOnly flag, and category metadata for the tool system rewrite.

- [#122](https://github.com/amodalai/amodal/pull/122) [`f8a8781`](https://github.com/amodalai/amodal/commit/f8a8781cb61afa20c3d57efff4df8c06f18e1111) Thanks [@gte620v](https://github.com/gte620v)! - Replace MultiProviderContentGenerator with VercelContentGenerator bridge. LLM calls now route through the Vercel AI SDK instead of our custom RuntimeProvider implementations. All 5 provider round-trip tests pass (Anthropic, OpenAI, Google, DeepSeek, Groq).

- Updated dependencies [[`42d1947`](https://github.com/amodalai/amodal/commit/42d194773515d196992cf9586819333b64d6187e)]:
  - @amodalai/core@0.2.0
  - @amodalai/types@0.2.0

## 0.1.26

### Patch Changes

- [#111](https://github.com/amodalai/amodal/pull/111) [`5b01f5e`](https://github.com/amodalai/amodal/commit/5b01f5e57792c94e51c286c7772095354684fdc8) Thanks [@gte620v](https://github.com/gte620v)! - Create @amodalai/types package with shared type definitions extracted from @amodalai/core. Zero runtime dependencies. Core re-exports all types for backward compatibility.

- [#118](https://github.com/amodalai/amodal/pull/118) [`73b9cdc`](https://github.com/amodalai/amodal/commit/73b9cdc0cdb781bd61ab65f24e49663af8cabe4d) Thanks [@gte620v](https://github.com/gte620v)! - Add provider round-trip integration tests for Anthropic, OpenAI, Google, DeepSeek, and Groq. Tests verify text responses, tool calls, and streaming for each provider. Skipped automatically when API keys are not set.

- [#116](https://github.com/amodalai/amodal/pull/116) [`5165f4b`](https://github.com/amodalai/amodal/commit/5165f4bf0d4ea7eb88b7803193b01131769bb3c8) Thanks [@gte620v](https://github.com/gte620v)! - Add SSE event contract tests verifying event shapes, ordering, and type safety for the streaming event protocol.

- [#114](https://github.com/amodalai/amodal/pull/114) [`51f0c46`](https://github.com/amodalai/amodal/commit/51f0c4635d86b7280a4006f29f9eb82cc68a75b6) Thanks [@gte620v](https://github.com/gte620v)! - Upgrade logger with child() scoped loggers, JSON output mode, and sanitize hook. Backward-compatible with existing log.info(message, tag) call pattern.

- [#117](https://github.com/amodalai/amodal/pull/117) [`08dbc02`](https://github.com/amodalai/amodal/commit/08dbc02a322feb1673b619126617b094b7397094) Thanks [@gte620v](https://github.com/gte620v)! - Add Phase 0.6 tool execution integration tests (store CRUD, custom tools, connection requests)

- [#113](https://github.com/amodalai/amodal/pull/113) [`3bbf563`](https://github.com/amodalai/amodal/commit/3bbf563bc200cefcd29979c549fd325a98bf9d8d) Thanks [@gte620v](https://github.com/gte620v)! - Add typed error classes (AmodalError base + ProviderError, ToolExecutionError, StoreError, ConnectionError, SessionError, CompactionError, ConfigError) and Result<T, E> type for structured error handling across module boundaries.

- Updated dependencies [[`5b01f5e`](https://github.com/amodalai/amodal/commit/5b01f5e57792c94e51c286c7772095354684fdc8), [`51f0c46`](https://github.com/amodalai/amodal/commit/51f0c4635d86b7280a4006f29f9eb82cc68a75b6)]:
  - @amodalai/types@0.1.26
  - @amodalai/core@0.1.26

## 0.1.25

### Patch Changes

- [#106](https://github.com/amodalai/amodal/pull/106) [`93f3a8e`](https://github.com/amodalai/amodal/commit/93f3a8ec4e782180ae2fdb8eeb7daf4bdd754f4d) Thanks [@whodatdev](https://github.com/whodatdev)! - Export `runMessage` and `routeOutput` from package entry point for hosted-runtime automation support

- [#100](https://github.com/amodalai/amodal/pull/100) [`d7eeb11`](https://github.com/amodalai/amodal/commit/d7eeb11c32813c45c718cb5a8f2b50bf4ac5abde) Thanks [@gte620v](https://github.com/gte620v)! - Add thinking spinner with elapsed timer to all chats. PGLite lock file warns on concurrent access. Postgres backend config support (graceful fallback to PGLite).

- Updated dependencies []:
  - @amodalai/core@0.1.25

## 0.1.24

### Patch Changes

- [#102](https://github.com/amodalai/amodal/pull/102) [`c1c4c45`](https://github.com/amodalai/amodal/commit/c1c4c4567f17a18c0d415d3a9dd9421573bdc988) Thanks [@whodatdev](https://github.com/whodatdev)! - Fix buildDefaultPrompt using wrong bundle reference for bundleProvider sessions, causing system prompt to omit connections, skills, knowledge, and field guidance.

- Updated dependencies []:
  - @amodalai/core@0.1.24

## 0.1.23

### Patch Changes

- [#96](https://github.com/amodalai/amodal/pull/96) [`7714733`](https://github.com/amodalai/amodal/commit/77147335bc999f4e5d23a0840a23406b8b62f8e7) Thanks [@gte620v](https://github.com/gte620v)! - Fix custom tool ctx.request() to use correct connection config field names (base_url, \_request_config.auth) and enforce write intent for mutating HTTP methods

- [#101](https://github.com/amodalai/amodal/pull/101) [`2351f6f`](https://github.com/amodalai/amodal/commit/2351f6fe807fb4039c1b6d1d67def3e142af1880) Thanks [@whodatdev](https://github.com/whodatdev)! - Add structured logging with configurable log levels (LOG_LEVEL env var). Replace all process.stderr.write calls with a shared logger supporting debug/info/warn/error/fatal levels. Add debug-level logging of the full LLM request payload in MultiProviderContentGenerator.

- Updated dependencies [[`7714733`](https://github.com/amodalai/amodal/commit/77147335bc999f4e5d23a0840a23406b8b62f8e7), [`2351f6f`](https://github.com/amodalai/amodal/commit/2351f6fe807fb4039c1b6d1d67def3e142af1880)]:
  - @amodalai/core@0.1.23

## 0.1.22

### Patch Changes

- [#94](https://github.com/amodalai/amodal/pull/94) [`efb9a54`](https://github.com/amodalai/amodal/commit/efb9a54bc0095fd71e737d1ef04c5495a4171452) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove AgentSDK and platformApiUrl from SessionManager. The OSS runtime no longer makes platform API calls — the hosting layer delivers fully resolved bundles via bundleProvider. Simplify SessionStore interface to not require auth params. Unify chat routes onto createChatStreamRouter, removing the old agent/routes/chat.ts.

- [#84](https://github.com/amodalai/amodal/pull/84) [`ba75ebe`](https://github.com/amodalai/amodal/commit/ba75ebeed040baeba4b82f80d9f42890a60e3d87) Thanks [@gte620v](https://github.com/gte620v)! - Page metadata for data source dependencies (stores/automations), batch store tool, tool handler TypeScript compilation, tool log telemetry, PGLite write queue and error handling, LOCAL_APP_ID constant, automation inline tool cards, chat ?prompt= param, live sidebar polling, page error boundary.

- Updated dependencies [[`efb9a54`](https://github.com/amodalai/amodal/commit/efb9a54bc0095fd71e737d1ef04c5495a4171452), [`ba75ebe`](https://github.com/amodalai/amodal/commit/ba75ebeed040baeba4b82f80d9f42890a60e3d87)]:
  - @amodalai/core@0.1.22

## 0.1.21

### Patch Changes

- [#91](https://github.com/amodalai/amodal/pull/91) [`f489f19`](https://github.com/amodalai/amodal/commit/f489f19b1e776f53d70b8288ff675c177286377e) Thanks [@whodatdev](https://github.com/whodatdev)! - Pass caller's auth token to bundleProvider so the hosted runtime can fetch deploy snapshots using the user's JWT instead of requiring a service API key.

- Updated dependencies []:
  - @amodalai/core@0.1.21

## 0.1.20

### Patch Changes

- [#89](https://github.com/amodalai/amodal/pull/89) [`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb) Thanks [@whodatdev](https://github.com/whodatdev)! - Rename AmodalRepo to AgentBundle across public APIs: snapshotToRepo → snapshotToBundle, repoProvider → bundleProvider, getRepo → getBundle, updateRepo → updateBundle, SnapshotServerConfig.repo → .bundle, SessionManagerOptions.repo → .bundle. Fix "New chat" button not resetting the chat when already on the chat screen. Fix useAmodalChat reset() not clearing sessionIdRef.

- Updated dependencies [[`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb)]:
  - @amodalai/core@0.1.20

## 0.1.19

### Patch Changes

- Updated dependencies []:
  - @amodalai/core@0.1.19

## 0.1.18

### Patch Changes

- [#85](https://github.com/amodalai/amodal/pull/85) [`c8b5bae`](https://github.com/amodalai/amodal/commit/c8b5bae686a8225cf80331d339db4c79eaf0009d) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove app_id from client-server protocol. Server resolves app from hostname/auth context.

  Breaking: AmodalProvider no longer accepts appId prop. RuntimeClient no longer sends app_id. SessionCreator and SessionHydrator signatures changed. Chat/task schemas no longer include app_id.

  New: POST /auth/token on local dev returns empty token. useAuth hook replaces useHostedConfig. runtime-app publishes source for hosted builds. CLI deploy triggers remote Fly build.

- Updated dependencies []:
  - @amodalai/core@0.1.18

## 0.1.17

### Patch Changes

- [#73](https://github.com/amodalai/amodal/pull/73) [`83f08b4`](https://github.com/amodalai/amodal/commit/83f08b48270e24801923c911eb745cdcecf13fa9) Thanks [@whodatdev](https://github.com/whodatdev)! - Extract platform-specific code from OSS runtime into injectable hooks.

  **Breaking:** `createAuthMiddleware` and `AuditClient` are no longer exported from `@amodalai/runtime`. Auth middleware, audit logging, usage reporting, and session history persistence are now provided by the hosting layer via `CreateServerOptions.authMiddleware`, `streamHooks`, `additionalRouters`, and `onShutdown`.

  **New exports:** `StreamHooks`, `SessionStore`, `StoredSessionRecord` interfaces for hosting layer integration.

  **`@amodalai/core`:** `AgentSDK` constructor now accepts an optional third `platformClient` parameter for dependency injection.

- [#78](https://github.com/amodalai/amodal/pull/78) [`14ef749`](https://github.com/amodalai/amodal/commit/14ef749ba9ccf3b74dbf86e3959c609682eda198) Thanks [@gte620v](https://github.com/gte620v)! - Show installed package files in the config Files view alongside local repo files. Package files display a purple package icon and "package" badge in the editor.

- [#76](https://github.com/amodalai/amodal/pull/76) [`b6aa9f3`](https://github.com/amodalai/amodal/commit/b6aa9f390863ad71545867be40e24587e85eb646) Thanks [@gte620v](https://github.com/gte620v)! - Fix admin agent session: restore skills, knowledge, file tools, and path validation

  The session manager refactor ([#68](https://github.com/amodalai/amodal/issues/68)) broke the admin agent by dropping admin skills/knowledge from the prompt, removing file tools (read/write/delete_repo_file), and losing path validation. Admin sessions now temporarily swap repo fields to inject admin content, register file tools with full security checks, and verify local-only access.

- [#75](https://github.com/amodalai/amodal/pull/75) [`0c3c202`](https://github.com/amodalai/amodal/commit/0c3c20207bb92ed1321373e474be83d315c1a1b2) Thanks [@gte620v](https://github.com/gte620v)! - Fix eval token counting, prompt context, judge accuracy, and tool result handling
  - Fix prompt regression: include skills, knowledge, and connection API docs in system prompt (were silently dropped by session manager refactor)
  - Fix token counting: accumulate usage across multiple done events, route Google through MPCG adapter for consistent counts, emit usage on all Done event paths
  - Fix judge: direct LLM calls instead of full agent session (90% cheaper), grade text response quality not tool results, require specific evidence
  - Fix tool results: remove all truncation (session runner 2K, SSE 500, eval route 4K), pass full output to judge
  - Fix request tool: coerce params to strings (prevents "must be string" schema errors), relax additionalProperties constraint
  - Add collapsible tool results in UI (2-line preview, click to expand)
  - Add elapsed timer with running/judging phase indicator
  - Add DeepSeek/Groq providers and model pricing
  - Prompt improvements: answer directly before analyzing, retry with different params on empty results

- [#79](https://github.com/amodalai/amodal/pull/79) [`fb49f28`](https://github.com/amodalai/amodal/commit/fb49f284bc427e7dc13a0c43653a55a28b23afb3) Thanks [@gte620v](https://github.com/gte620v)! - Add user feedback system: thumbs up/down on responses with admin synthesis
  - Thumbs up/down on assistant messages in dev UI chat and embedded React widget
  - Optional text comment on thumbs down
  - Feedback persisted to .amodal/feedback/ as JSON files
  - Admin dashboard page with stats, feedback list, and LLM synthesis button
  - Admin agent can query feedback via internal_api tool

- Updated dependencies [[`83f08b4`](https://github.com/amodalai/amodal/commit/83f08b48270e24801923c911eb745cdcecf13fa9), [`0c3c202`](https://github.com/amodalai/amodal/commit/0c3c20207bb92ed1321373e474be83d315c1a1b2), [`fb49f28`](https://github.com/amodalai/amodal/commit/fb49f284bc427e7dc13a0c43653a55a28b23afb3)]:
  - @amodalai/core@0.1.17

## 0.1.16

### Patch Changes

- [#69](https://github.com/amodalai/amodal/pull/69) [`407b935`](https://github.com/amodalai/amodal/commit/407b93586178fa19d7c6162f03e259039df336c4) Thanks [@gte620v](https://github.com/gte620v)! - Add prompt caching, multi-model eval comparison, and new provider support
  - Anthropic prompt caching: system prompt and tools sent with cache_control, 90% input cost savings on cache hits
  - Cache-aware cost tracking throughout eval system with savings display
  - Multi-model eval comparison: run evals against multiple models side-by-side with color-graded time/cost table
  - Per-eval history with assertion breakdown, model info, and collapsible UI
  - DeepSeek and Groq provider support via OpenAI-compatible endpoints
  - Configurable eval timeout (20s–300s slider)
  - Tool results now visible in eval output for judge verification
  - Improved judge prompt for specific, evidence-based failure reasoning
  - Auth/rate-limit errors surfaced with actionable UI messaging
  - ConfigWatcher no longer triggers reload spam from eval result writes
  - Session reuse during eval runs to minimize MCP reconnections

- [#68](https://github.com/amodalai/amodal/pull/68) [`f99b2a1`](https://github.com/amodalai/amodal/commit/f99b2a1d836ee4f57a335182897af696bfce9502) Thanks [@whodatdev](https://github.com/whodatdev)! - Unify local and hosted server onto a single SessionManager, replacing AgentSessionManager + runAgentTurn with SessionManager + streamMessage. Adds minimal Config init for non-Google providers, CustomToolAdapter for repo tools, and configurable coreTools from repo config.

- Updated dependencies [[`407b935`](https://github.com/amodalai/amodal/commit/407b93586178fa19d7c6162f03e259039df336c4), [`f99b2a1`](https://github.com/amodalai/amodal/commit/f99b2a1d836ee4f57a335182897af696bfce9502)]:
  - @amodalai/core@0.1.16

## 0.1.15

### Patch Changes

- [#62](https://github.com/amodalai/amodal/pull/62) [`c2298d6`](https://github.com/amodalai/amodal/commit/c2298d614e86491d07c954092d2044b32dd94281) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent file tools (read, write, delete) for configuring agents via chat. Config UI improvements: sidebar admin toggle, persistent chat, file tree auto-refresh with reload button. Fix runtime-app package.json exports for running from source.

- [#63](https://github.com/amodalai/amodal/pull/63) [`9319d95`](https://github.com/amodalai/amodal/commit/9319d9536a6dac0afa325df49fa9c6f5773f5835) Thanks [@gte620v](https://github.com/gte620v)! - Eval UI on config page, dev workflow improvements (pnpm link, dev:build, -dev version suffix).

- Updated dependencies []:
  - @amodalai/core@0.1.15

## 0.1.14

### Patch Changes

- [#60](https://github.com/amodalai/amodal/pull/60) [`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c) Thanks [@gte620v](https://github.com/gte620v)! - Session rename/delete, rich tool call cards, admin chat split pane, suppress OpenTelemetry warning, init cleanup.

- Updated dependencies []:
  - @amodalai/core@0.1.14

## 0.1.13

### Patch Changes

- Updated dependencies []:
  - @amodalai/core@0.1.13

## 0.1.12

### Patch Changes

- [#53](https://github.com/amodalai/amodal/pull/53) [`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent for config chat. Fetched from registry, cached at ~/.amodal/admin-agent/. Config section defaults to admin chat. Update via `amodal update --admin-agent`.

- Updated dependencies [[`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a)]:
  - @amodalai/core@0.1.12

## 0.1.11

### Patch Changes

- [#47](https://github.com/amodalai/amodal/pull/47) [`61ab675`](https://github.com/amodalai/amodal/commit/61ab67585161c751772c89126d2fa1e8fe03ce8a) Thanks [@gte620v](https://github.com/gte620v)! - Add file browser and editor to config screen

- [#46](https://github.com/amodalai/amodal/pull/46) [`84ce38f`](https://github.com/amodalai/amodal/commit/84ce38f43b697d2ed6ebbf0ca0e0c85ab8513663) Thanks [@gte620v](https://github.com/gte620v)! - Add config page with Agent, Models, Prompt Inspector, Secrets, and System sections. Gear icon in header navigates to /config. Prompt inspector shows token usage bar, section breakdown, and full compiled prompt.

- [#48](https://github.com/amodalai/amodal/pull/48) [`bfc1e77`](https://github.com/amodalai/amodal/commit/bfc1e772270567037adad08323e6c1ba5035855a) Thanks [@whodatdev](https://github.com/whodatdev)! - Add runtime-app hosting support: fallbackMiddleware option on createServer, CLI deploys repo tarball to build server, logout command, automatic token refresh

- [#44](https://github.com/amodalai/amodal/pull/44) [`fe4785d`](https://github.com/amodalai/amodal/commit/fe4785d0106eb39583b64b282bb89522dcaf92ef) Thanks [@gte620v](https://github.com/gte620v)! - Unified connection and MCP view with per-connection health status

- Updated dependencies [[`26034c6`](https://github.com/amodalai/amodal/commit/26034c6ac223b0e203f59ab820858ff3e3fe47de)]:
  - @amodalai/core@0.1.11

## 0.1.10

### Patch Changes

- [#38](https://github.com/amodalai/amodal/pull/38) [`4840b56`](https://github.com/amodalai/amodal/commit/4840b56219db2b499a740bd1477b8f7365f205f8) Thanks [@gte620v](https://github.com/gte620v)! - Automations page with Run Now button, run history tracking, and improved API. Shows title, prompt, schedule, trigger type, last run status. Run Now waits for completion and shows success/error.

- [#42](https://github.com/amodalai/amodal/pull/42) [`e9453a3`](https://github.com/amodalai/amodal/commit/e9453a30a2084441868efc3d5833817e860911f6) Thanks [@gte620v](https://github.com/gte620v)! - Fix: inspect detail endpoints read repo directly instead of creating sessions (which triggered MCP reconnections). Render skill body as markdown.

- Updated dependencies []:
  - @amodalai/core@0.1.10

## 0.1.9

### Patch Changes

- [#31](https://github.com/amodalai/amodal/pull/31) [`dd9a04f`](https://github.com/amodalai/amodal/commit/dd9a04fcd732abc17188cc473a9ea4794922acfc) Thanks [@gte620v](https://github.com/gte620v)! - Persist chat sessions to disk. Sessions survive server restarts and can be resumed with `amodal chat --resume latest` or `--resume <session-id>`.

- [#35](https://github.com/amodalai/amodal/pull/35) [`f9d4e5f`](https://github.com/amodalai/amodal/commit/f9d4e5fde9c623a8f93f8ab6471263824489a86a) Thanks [@gte620v](https://github.com/gte620v)! - Display token usage in the web chat UI. Tracks cumulative input/output tokens across all turns in a session. Usage data flows from LLM provider → agent runner → SSE done event → react hook → UI.

- Updated dependencies []:
  - @amodalai/core@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies []:
  - @amodalai/core@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [[`90ce461`](https://github.com/amodalai/amodal/commit/90ce46146398cad6e33f1b0794457142d7b38f1a)]:
  - @amodalai/core@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [[`e4c29ea`](https://github.com/amodalai/amodal/commit/e4c29ea5f768f1514e82fef2585bb7f63588075a)]:
  - @amodalai/core@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [[`d0778a5`](https://github.com/amodalai/amodal/commit/d0778a521f2f298fe7ca144c37211c4af3bdc392)]:
  - @amodalai/core@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies []:
  - @amodalai/core@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @amodalai/core@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @amodalai/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @amodalai/core@0.1.1
