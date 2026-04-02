# @amodalai/core

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
