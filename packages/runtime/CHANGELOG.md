# @amodalai/runtime

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
