# @amodalai/core

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.1

## 0.3.0

### Minor Changes

- [#194](https://github.com/amodalai/amodal/pull/194) [`13723ff`](https://github.com/amodalai/amodal/commit/13723ff5be1e9983a1a66c697ec352d3a2dbfcd7) Thanks [@gte620v](https://github.com/gte620v)! - Studio standalone: separate Studio into its own Next.js service, strip admin code from runtime, add workspace tools, update CLI to spawn Studio + admin agent subprocesses

- [#194](https://github.com/amodalai/amodal/pull/194) [`13723ff`](https://github.com/amodalai/amodal/commit/13723ff5be1e9983a1a66c697ec352d3a2dbfcd7) Thanks [@gte620v](https://github.com/gte620v)! - Studio admin UI: move all admin/config/stores/automations/evals/feedback to Studio. Runtime-app is now chat + pages only. Postgres required (no PGLite). DATABASE_URL configuration via ~/.amodal/env or agent .env.

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.0

## 0.2.10

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.10

## 0.2.9

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.9

## 0.2.8

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.5

## 0.2.4

### Patch Changes

- [#174](https://github.com/amodalai/amodal/pull/174) [`0132204`](https://github.com/amodalai/amodal/commit/0132204a35f457e067fc5150a219f264a0f0955c) Thanks [@gte620v](https://github.com/gte620v)! - Add image output support in tool results. Tool call results are now sent to the frontend via SSE. MCP adapter preserves image content blocks instead of discarding them. Google provider extracts Gemini native image parts. Image-aware snipping prevents base64 data from being destroyed by truncation. New ImagePreview component renders image thumbnails in ToolCallCard.

- [#172](https://github.com/amodalai/amodal/pull/172) [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517) Thanks [@gte620v](https://github.com/gte620v)! - Add image paste support to chat

  Users can paste images from the clipboard into the chat input. Images show as removable thumbnails before sending, then render in the user message bubble. Vision-capable providers (Anthropic, Google, OpenAI) receive the image; non-vision providers strip it with a warning. Images are stored in a separate `image_data` column to avoid JSONB bloat, with automatic rehydration on session load.

- Updated dependencies [[`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517)]:
  - @amodalai/types@0.2.4

## 0.2.3

### Patch Changes

- [#169](https://github.com/amodalai/amodal/pull/169) [`83d0153`](https://github.com/amodalai/amodal/commit/83d01530ae0b85cf7333df75e6fe15cabb1cb63b) Thanks [@whodatdev](https://github.com/whodatdev)! - Add messaging channels to deploy snapshots

- Updated dependencies [[`83d0153`](https://github.com/amodalai/amodal/commit/83d01530ae0b85cf7333df75e6fe15cabb1cb63b)]:
  - @amodalai/types@0.2.3

## 0.2.2

### Patch Changes

- [#168](https://github.com/amodalai/amodal/pull/168) [`024207b`](https://github.com/amodalai/amodal/commit/024207b91220acfc9e44a73499dfd64124f54ab0) Thanks [@whodatdev](https://github.com/whodatdev)! - Update channel resolver to scan channels/<name>/channel.json

  Matches the connection package convention where metadata lives under
  connections/<name>/. Allows a single package to contain multiple channels.

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

- Updated dependencies [[`f4d59ea`](https://github.com/amodalai/amodal/commit/f4d59eae060aa5fa35e1f2f756413457a4d5331b), [`1523d96`](https://github.com/amodalai/amodal/commit/1523d96f2bb1d6b5e2f0023690f9abb371b88fd3), [`a33e080`](https://github.com/amodalai/amodal/commit/a33e0807e6607c88aa203f5dd2c1bf89299026d8)]:
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

- Updated dependencies [[`745228d`](https://github.com/amodalai/amodal/commit/745228db110b6da50e0514f6dc90250037ada958), [`cdcf62f`](https://github.com/amodalai/amodal/commit/cdcf62f90f42a3a6064f7e86cdcfa0293493e949), [`57b143f`](https://github.com/amodalai/amodal/commit/57b143fac3c0de23651dd26a295be9ee553a91d1)]:
  - @amodalai/types@0.2.1

## 0.2.0

### Patch Changes

- [#144](https://github.com/amodalai/amodal/pull/144) [`42d1947`](https://github.com/amodalai/amodal/commit/42d194773515d196992cf9586819333b64d6187e) Thanks [@gte620v](https://github.com/gte620v)! - Remove gemini-cli-core dependency and add public createAgent() API (Phase 4.1 + 4.2)

- Updated dependencies []:
  - @amodalai/types@0.2.0

## 0.1.26

### Patch Changes

- [#111](https://github.com/amodalai/amodal/pull/111) [`5b01f5e`](https://github.com/amodalai/amodal/commit/5b01f5e57792c94e51c286c7772095354684fdc8) Thanks [@gte620v](https://github.com/gte620v)! - Create @amodalai/types package with shared type definitions extracted from @amodalai/core. Zero runtime dependencies. Core re-exports all types for backward compatibility.

- [#114](https://github.com/amodalai/amodal/pull/114) [`51f0c46`](https://github.com/amodalai/amodal/commit/51f0c4635d86b7280a4006f29f9eb82cc68a75b6) Thanks [@gte620v](https://github.com/gte620v)! - Upgrade logger with child() scoped loggers, JSON output mode, and sanitize hook. Backward-compatible with existing log.info(message, tag) call pattern.

- Updated dependencies [[`5b01f5e`](https://github.com/amodalai/amodal/commit/5b01f5e57792c94e51c286c7772095354684fdc8)]:
  - @amodalai/types@0.1.26

## 0.1.25

## 0.1.24

## 0.1.23

### Patch Changes

- [#96](https://github.com/amodalai/amodal/pull/96) [`7714733`](https://github.com/amodalai/amodal/commit/77147335bc999f4e5d23a0840a23406b8b62f8e7) Thanks [@gte620v](https://github.com/gte620v)! - Fix custom tool ctx.request() to use correct connection config field names (base_url, \_request_config.auth) and enforce write intent for mutating HTTP methods

- [#101](https://github.com/amodalai/amodal/pull/101) [`2351f6f`](https://github.com/amodalai/amodal/commit/2351f6fe807fb4039c1b6d1d67def3e142af1880) Thanks [@whodatdev](https://github.com/whodatdev)! - Add structured logging with configurable log levels (LOG_LEVEL env var). Replace all process.stderr.write calls with a shared logger supporting debug/info/warn/error/fatal levels. Add debug-level logging of the full LLM request payload in MultiProviderContentGenerator.

## 0.1.22

### Patch Changes

- [#94](https://github.com/amodalai/amodal/pull/94) [`efb9a54`](https://github.com/amodalai/amodal/commit/efb9a54bc0095fd71e737d1ef04c5495a4171452) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove AgentSDK and platformApiUrl from SessionManager. The OSS runtime no longer makes platform API calls — the hosting layer delivers fully resolved bundles via bundleProvider. Simplify SessionStore interface to not require auth params. Unify chat routes onto createChatStreamRouter, removing the old agent/routes/chat.ts.

- [#84](https://github.com/amodalai/amodal/pull/84) [`ba75ebe`](https://github.com/amodalai/amodal/commit/ba75ebeed040baeba4b82f80d9f42890a60e3d87) Thanks [@gte620v](https://github.com/gte620v)! - Page metadata for data source dependencies (stores/automations), batch store tool, tool handler TypeScript compilation, tool log telemetry, PGLite write queue and error handling, LOCAL_APP_ID constant, automation inline tool cards, chat ?prompt= param, live sidebar polling, page error boundary.

## 0.1.21

## 0.1.20

### Patch Changes

- [#89](https://github.com/amodalai/amodal/pull/89) [`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb) Thanks [@whodatdev](https://github.com/whodatdev)! - Rename AmodalRepo to AgentBundle across public APIs: snapshotToRepo → snapshotToBundle, repoProvider → bundleProvider, getRepo → getBundle, updateRepo → updateBundle, SnapshotServerConfig.repo → .bundle, SessionManagerOptions.repo → .bundle. Fix "New chat" button not resetting the chat when already on the chat screen. Fix useAmodalChat reset() not clearing sessionIdRef.

## 0.1.19

## 0.1.18

## 0.1.17

### Patch Changes

- [#73](https://github.com/amodalai/amodal/pull/73) [`83f08b4`](https://github.com/amodalai/amodal/commit/83f08b48270e24801923c911eb745cdcecf13fa9) Thanks [@whodatdev](https://github.com/whodatdev)! - Extract platform-specific code from OSS runtime into injectable hooks.

  **Breaking:** `createAuthMiddleware` and `AuditClient` are no longer exported from `@amodalai/runtime`. Auth middleware, audit logging, usage reporting, and session history persistence are now provided by the hosting layer via `CreateServerOptions.authMiddleware`, `streamHooks`, `additionalRouters`, and `onShutdown`.

  **New exports:** `StreamHooks`, `SessionStore`, `StoredSessionRecord` interfaces for hosting layer integration.

  **`@amodalai/core`:** `AgentSDK` constructor now accepts an optional third `platformClient` parameter for dependency injection.

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

## 0.1.15

## 0.1.14

## 0.1.13

## 0.1.12

### Patch Changes

- [#53](https://github.com/amodalai/amodal/pull/53) [`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent for config chat. Fetched from registry, cached at ~/.amodal/admin-agent/. Config section defaults to admin chat. Update via `amodal update --admin-agent`.

## 0.1.11

### Patch Changes

- [#49](https://github.com/amodalai/amodal/pull/49) [`26034c6`](https://github.com/amodalai/amodal/commit/26034c6ac223b0e203f59ab820858ff3e3fe47de) Thanks [@gte620v](https://github.com/gte620v)! - Untyped package registry with dependency resolution. Packages are bundles that can contain any combination of connections, skills, automations, knowledge, stores, tools, pages, and agents. Lock file keyed by npm name. npm handles transitive dependency resolution. CLI simplified: `amodal install <name>` instead of `amodal install <type> <name>`.

## 0.1.10

## 0.1.9

## 0.1.8

## 0.1.7

### Patch Changes

- [#24](https://github.com/amodalai/amodal/pull/24) [`90ce461`](https://github.com/amodalai/amodal/commit/90ce46146398cad6e33f1b0794457142d7b38f1a) Thanks [@gte620v](https://github.com/gte620v)! - Add live connection testing to validate command and testPath field to connection spec

## 0.1.6

### Patch Changes

- [#21](https://github.com/amodalai/amodal/pull/21) [`e4c29ea`](https://github.com/amodalai/amodal/commit/e4c29ea5f768f1514e82fef2585bb7f63588075a) Thanks [@gte620v](https://github.com/gte620v)! - Add headers support for MCP HTTP/SSE transports to enable authenticated MCP servers

## 0.1.5

### Patch Changes

- [#19](https://github.com/amodalai/amodal/pull/19) [`d0778a5`](https://github.com/amodalai/amodal/commit/d0778a521f2f298fe7ca144c37211c4af3bdc392) Thanks [@gte620v](https://github.com/gte620v)! - Rename `source` to `specUrl` (optional) and make `baseUrl` required in connection spec.json. Connections without an API spec document no longer fail validation.

## 0.1.4

## 0.1.3

## 0.1.2

## 0.1.1
