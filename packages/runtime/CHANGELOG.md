# @amodalai/runtime

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
