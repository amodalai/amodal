# @amodalai/amodal

## 0.1.17

### Patch Changes

- Updated dependencies [[`86084ff`](https://github.com/amodalai/amodal/commit/86084ff0435e58bcb0f738ae88ef6179a3278f9d), [`83f08b4`](https://github.com/amodalai/amodal/commit/83f08b48270e24801923c911eb745cdcecf13fa9), [`14ef749`](https://github.com/amodalai/amodal/commit/14ef749ba9ccf3b74dbf86e3959c609682eda198), [`b6aa9f3`](https://github.com/amodalai/amodal/commit/b6aa9f390863ad71545867be40e24587e85eb646), [`0c3c202`](https://github.com/amodalai/amodal/commit/0c3c20207bb92ed1321373e474be83d315c1a1b2), [`fb49f28`](https://github.com/amodalai/amodal/commit/fb49f284bc427e7dc13a0c43653a55a28b23afb3)]:
  - @amodalai/runtime-app@0.1.17
  - @amodalai/runtime@0.1.17
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

- Updated dependencies [[`407b935`](https://github.com/amodalai/amodal/commit/407b93586178fa19d7c6162f03e259039df336c4), [`f99b2a1`](https://github.com/amodalai/amodal/commit/f99b2a1d836ee4f57a335182897af696bfce9502)]:
  - @amodalai/core@0.1.16
  - @amodalai/runtime@0.1.16
  - @amodalai/runtime-app@0.1.16

## 0.1.15

### Patch Changes

- [#62](https://github.com/amodalai/amodal/pull/62) [`c2298d6`](https://github.com/amodalai/amodal/commit/c2298d614e86491d07c954092d2044b32dd94281) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent file tools (read, write, delete) for configuring agents via chat. Config UI improvements: sidebar admin toggle, persistent chat, file tree auto-refresh with reload button. Fix runtime-app package.json exports for running from source.

- [#65](https://github.com/amodalai/amodal/pull/65) [`f4f538e`](https://github.com/amodalai/amodal/commit/f4f538ef39f970820dce5955acdd363cc2c56247) Thanks [@whodatdev](https://github.com/whodatdev)! - Refactor runtime app to use deploy-id based config bootstrap. Add useHostedConfig hook that fetches config from the platform API instead of reading server-injected window.**AMODAL_CONFIG**. Load .env from project directory in dev command. Export ./package.json from runtime-app for require.resolve compatibility.

- [#63](https://github.com/amodalai/amodal/pull/63) [`9319d95`](https://github.com/amodalai/amodal/commit/9319d9536a6dac0afa325df49fa9c6f5773f5835) Thanks [@gte620v](https://github.com/gte620v)! - Eval UI on config page, dev workflow improvements (pnpm link, dev:build, -dev version suffix).

- Updated dependencies [[`c2298d6`](https://github.com/amodalai/amodal/commit/c2298d614e86491d07c954092d2044b32dd94281), [`f4f538e`](https://github.com/amodalai/amodal/commit/f4f538ef39f970820dce5955acdd363cc2c56247), [`9319d95`](https://github.com/amodalai/amodal/commit/9319d9536a6dac0afa325df49fa9c6f5773f5835)]:
  - @amodalai/runtime@0.1.15
  - @amodalai/runtime-app@0.1.15
  - @amodalai/core@0.1.15

## 0.1.14

### Patch Changes

- [#61](https://github.com/amodalai/amodal/pull/61) [`f4d5b06`](https://github.com/amodalai/amodal/commit/f4d5b062f738b105568966e6bc51dc1745afe277) Thanks [@gte620v](https://github.com/gte620v)! - Group CLI commands under pkg, deploy, ops, and auth subcommands. 35 top-level commands → 11 entries.

- [#57](https://github.com/amodalai/amodal/pull/57) [`67b8faa`](https://github.com/amodalai/amodal/commit/67b8faaa2e18084b78c5ed29fdbf7467583f4a8d) Thanks [@gte620v](https://github.com/gte620v)! - Fix "Cannot GET /" in `amodal dev`: move runtime-app from optional peer dependency to a real dependency and use Node module resolution to find the SPA assets.

- [#60](https://github.com/amodalai/amodal/pull/60) [`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c) Thanks [@gte620v](https://github.com/gte620v)! - Session rename/delete, rich tool call cards, admin chat split pane, suppress OpenTelemetry warning, init cleanup.

- Updated dependencies [[`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c)]:
  - @amodalai/runtime@0.1.14
  - @amodalai/runtime-app@0.1.14
  - @amodalai/core@0.1.14

## 0.1.13

### Patch Changes

- [#55](https://github.com/amodalai/amodal/pull/55) [`125be18`](https://github.com/amodalai/amodal/commit/125be187872d3091b2ee240054145bcd0fb3a088) Thanks [@gte620v](https://github.com/gte620v)! - Fix "Cannot GET /" in `amodal dev`: move runtime-app from optional peer dependency to a real dependency and use Node module resolution to find the SPA assets.

- Updated dependencies []:
  - @amodalai/core@0.1.13
  - @amodalai/runtime@0.1.13
  - @amodalai/runtime-app@0.1.13

## 0.1.12

### Patch Changes

- [#53](https://github.com/amodalai/amodal/pull/53) [`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent for config chat. Fetched from registry, cached at ~/.amodal/admin-agent/. Config section defaults to admin chat. Update via `amodal update --admin-agent`.

- Updated dependencies [[`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a)]:
  - @amodalai/core@0.1.12
  - @amodalai/runtime@0.1.12
  - @amodalai/runtime-app@0.1.12

## 0.1.11

### Patch Changes

- [#46](https://github.com/amodalai/amodal/pull/46) [`84ce38f`](https://github.com/amodalai/amodal/commit/84ce38f43b697d2ed6ebbf0ca0e0c85ab8513663) Thanks [@gte620v](https://github.com/gte620v)! - Add config page with Agent, Models, Prompt Inspector, Secrets, and System sections. Gear icon in header navigates to /config. Prompt inspector shows token usage bar, section breakdown, and full compiled prompt.

- [#48](https://github.com/amodalai/amodal/pull/48) [`bfc1e77`](https://github.com/amodalai/amodal/commit/bfc1e772270567037adad08323e6c1ba5035855a) Thanks [@whodatdev](https://github.com/whodatdev)! - Add runtime-app hosting support: fallbackMiddleware option on createServer, CLI deploys repo tarball to build server, logout command, automatic token refresh

- [#49](https://github.com/amodalai/amodal/pull/49) [`26034c6`](https://github.com/amodalai/amodal/commit/26034c6ac223b0e203f59ab820858ff3e3fe47de) Thanks [@gte620v](https://github.com/gte620v)! - Untyped package registry with dependency resolution. Packages are bundles that can contain any combination of connections, skills, automations, knowledge, stores, tools, pages, and agents. Lock file keyed by npm name. npm handles transitive dependency resolution. CLI simplified: `amodal install <name>` instead of `amodal install <type> <name>`.

- Updated dependencies [[`61ab675`](https://github.com/amodalai/amodal/commit/61ab67585161c751772c89126d2fa1e8fe03ce8a), [`84ce38f`](https://github.com/amodalai/amodal/commit/84ce38f43b697d2ed6ebbf0ca0e0c85ab8513663), [`bfc1e77`](https://github.com/amodalai/amodal/commit/bfc1e772270567037adad08323e6c1ba5035855a), [`fe4785d`](https://github.com/amodalai/amodal/commit/fe4785d0106eb39583b64b282bb89522dcaf92ef), [`26034c6`](https://github.com/amodalai/amodal/commit/26034c6ac223b0e203f59ab820858ff3e3fe47de)]:
  - @amodalai/runtime@0.1.11
  - @amodalai/runtime-app@0.1.11
  - @amodalai/core@0.1.11

## 0.1.10

### Patch Changes

- [#38](https://github.com/amodalai/amodal/pull/38) [`4840b56`](https://github.com/amodalai/amodal/commit/4840b56219db2b499a740bd1477b8f7365f205f8) Thanks [@gte620v](https://github.com/gte620v)! - Automations page with Run Now button, run history tracking, and improved API. Shows title, prompt, schedule, trigger type, last run status. Run Now waits for completion and shows success/error.

- [#40](https://github.com/amodalai/amodal/pull/40) [`f12d716`](https://github.com/amodalai/amodal/commit/f12d7164a0190d33616414550c36b1d9610c2e22) Thanks [@gte620v](https://github.com/gte620v)! - Entity list redesign (card layout with smart field picking), dark mode for all entity components, remove chat bubble, sort automations alphabetically, add pre-push hook blocking direct pushes to main.

- [#42](https://github.com/amodalai/amodal/pull/42) [`e9453a3`](https://github.com/amodalai/amodal/commit/e9453a30a2084441868efc3d5833817e860911f6) Thanks [@gte620v](https://github.com/gte620v)! - Fix: inspect detail endpoints read repo directly instead of creating sessions (which triggered MCP reconnections). Render skill body as markdown.

- Updated dependencies [[`4840b56`](https://github.com/amodalai/amodal/commit/4840b56219db2b499a740bd1477b8f7365f205f8), [`e9453a3`](https://github.com/amodalai/amodal/commit/e9453a30a2084441868efc3d5833817e860911f6)]:
  - @amodalai/runtime@0.1.10
  - @amodalai/core@0.1.10
  - @amodalai/runtime-app@0.1.10

## 0.1.9

### Patch Changes

- [#34](https://github.com/amodalai/amodal/pull/34) [`7e0bad6`](https://github.com/amodalai/amodal/commit/7e0bad6d7f53392060d00db2678de0cd8fa461c8) Thanks [@gte620v](https://github.com/gte620v)! - Add light/dark mode toggle in the web UI header. Preference persists to localStorage. Dark mode is the default.

- [#36](https://github.com/amodalai/amodal/pull/36) [`992d0e0`](https://github.com/amodalai/amodal/commit/992d0e0b3655149d95854407301412e93147cec2) Thanks [@gte620v](https://github.com/gte620v)! - Publish runtime-app to npm so the web chat UI works with global CLI installs. Previously marked private, which meant `npm install -g @amodalai/amodal` couldn't resolve the runtime-app dependency.

- [#33](https://github.com/amodalai/amodal/pull/33) [`fcdf153`](https://github.com/amodalai/amodal/commit/fcdf15370b5211ad0bd3ca30dc61a6ba755249d7) Thanks [@gte620v](https://github.com/gte620v)! - Add session history UI: browse past conversations, view full message replay with markdown rendering, and resume from session detail page.

- [#31](https://github.com/amodalai/amodal/pull/31) [`dd9a04f`](https://github.com/amodalai/amodal/commit/dd9a04fcd732abc17188cc473a9ea4794922acfc) Thanks [@gte620v](https://github.com/gte620v)! - Persist chat sessions to disk. Sessions survive server restarts and can be resumed with `amodal chat --resume latest` or `--resume <session-id>`.

- [#35](https://github.com/amodalai/amodal/pull/35) [`f9d4e5f`](https://github.com/amodalai/amodal/commit/f9d4e5fde9c623a8f93f8ab6471263824489a86a) Thanks [@gte620v](https://github.com/gte620v)! - Display token usage in the web chat UI. Tracks cumulative input/output tokens across all turns in a session. Usage data flows from LLM provider → agent runner → SSE done event → react hook → UI.

- Updated dependencies [[`992d0e0`](https://github.com/amodalai/amodal/commit/992d0e0b3655149d95854407301412e93147cec2), [`dd9a04f`](https://github.com/amodalai/amodal/commit/dd9a04fcd732abc17188cc473a9ea4794922acfc), [`f9d4e5f`](https://github.com/amodalai/amodal/commit/f9d4e5fde9c623a8f93f8ab6471263824489a86a)]:
  - @amodalai/runtime-app@0.1.9
  - @amodalai/runtime@0.1.9
  - @amodalai/core@0.1.9

## 0.1.8

### Patch Changes

- [#27](https://github.com/amodalai/amodal/pull/27) [`e5ffdf0`](https://github.com/amodalai/amodal/commit/e5ffdf0f6cdbb6b4d9f62a9a9d3e481a61931a37) Thanks [@gte620v](https://github.com/gte620v)! - Fix browser chat UI not loading: correct package scope typo in runtime-app path resolution.

- [#30](https://github.com/amodalai/amodal/pull/30) [`ccd38eb`](https://github.com/amodalai/amodal/commit/ccd38eb0a72a07cabada10fb501fd95aae88ee46) Thanks [@gte620v](https://github.com/gte620v)! - Polish web chat UI: dark theme, real Amodal logo, greyscale favicon, markdown rendering, auto-grow input, connections and skills in sidebar, smarter streaming indicators.

- Updated dependencies []:
  - @amodalai/core@0.1.8
  - @amodalai/runtime@0.1.8
  - @amodalai/runtime-app@0.1.8

## 0.1.7

### Patch Changes

- [#26](https://github.com/amodalai/amodal/pull/26) [`5c6d813`](https://github.com/amodalai/amodal/commit/5c6d813345bfe607fd13a3414aa735fe3249a281) Thanks [@gte620v](https://github.com/gte620v)! - Fix input lag in terminal chat. Scroll keybindings (j/k/pageUp/pageDown) no longer intercept keystrokes while typing in the input bar.

- [#24](https://github.com/amodalai/amodal/pull/24) [`90ce461`](https://github.com/amodalai/amodal/commit/90ce46146398cad6e33f1b0794457142d7b38f1a) Thanks [@gte620v](https://github.com/gte620v)! - Add live connection testing to validate command and testPath field to connection spec

- Updated dependencies [[`90ce461`](https://github.com/amodalai/amodal/commit/90ce46146398cad6e33f1b0794457142d7b38f1a)]:
  - @amodalai/core@0.1.7
  - @amodalai/runtime@0.1.7
  - @amodalai/runtime-app@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [[`e4c29ea`](https://github.com/amodalai/amodal/commit/e4c29ea5f768f1514e82fef2585bb7f63588075a)]:
  - @amodalai/core@0.1.6
  - @amodalai/runtime@0.1.6
  - @amodalai/runtime-app@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [[`d0778a5`](https://github.com/amodalai/amodal/commit/d0778a521f2f298fe7ca144c37211c4af3bdc392)]:
  - @amodalai/core@0.1.5
  - @amodalai/runtime@0.1.5
  - @amodalai/runtime-app@0.1.5

## 0.1.4

### Patch Changes

- [#17](https://github.com/amodalai/amodal/pull/17) [`7a2b7d1`](https://github.com/amodalai/amodal/commit/7a2b7d1dd27588b626a23453f0f97f5e9317b275) Thanks [@gte620v](https://github.com/gte620v)! - Fix GitHub Release creation after npm publish

- Updated dependencies []:
  - @amodalai/core@0.1.4
  - @amodalai/runtime@0.1.4
  - @amodalai/runtime-app@0.1.4

## 0.1.3

### Patch Changes

- [#15](https://github.com/amodalai/amodal/pull/15) [`df201b5`](https://github.com/amodalai/amodal/commit/df201b542d943fbb887dd096f4e3e3d170c51030) Thanks [@gte620v](https://github.com/gte620v)! - Automatically load `.env` file from the project directory. No more `source .env &&` before every command.

- Updated dependencies []:
  - @amodalai/core@0.1.3
  - @amodalai/runtime@0.1.3
  - @amodalai/runtime-app@0.1.3

## 0.1.2

### Patch Changes

- [#13](https://github.com/amodalai/amodal/pull/13) [`2c767b7`](https://github.com/amodalai/amodal/commit/2c767b7265f112148ce88ee27001d8e38ac8c970) Thanks [@gte620v](https://github.com/gte620v)! - Fix `amodal --version` showing `0.0.0`. Read version from package.json at runtime as fallback when CLI is not bundled with esbuild. Rename package from `@amodalai/cli` to `@amodalai/amodal`.

- Updated dependencies []:
  - @amodalai/core@0.1.2
  - @amodalai/runtime@0.1.2
  - @amodalai/runtime-app@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @amodalai/runtime-app@0.1.1
  - @amodalai/core@0.1.1
  - @amodalai/runtime@0.1.1
