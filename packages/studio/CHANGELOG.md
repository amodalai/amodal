# @amodalai/studio

## 0.3.55

### Patch Changes

- 6612b89: Split the local-dev runner out of `studio-server.ts` into a separate `bin.ts`.

  Importing `@amodalai/studio/server` is now guaranteed side-effect-free: it just exposes `createStudioApp` and the named hooks. The previous gate (`import.meta.url === file://argv[1]`) was defeated whenever the file got bundled into a downstream consumer's entry — `import.meta.url` and `argv[1]` would both point at the consumer's bundle path, the gate evaluated true, and `main()` ran on import. This crashed cloud-studio's Vercel function on every cold start.

  Changes:
  - `packages/studio/src/server/bin.ts` (new) — owns `main()`, `serve()`, the PG `LISTEN` setup, signal handlers, and the `process.exit(1)` on fatal.
  - `packages/studio/src/server/studio-server.ts` — keeps only the library exports and `createStudioApp`. No more `main()`, no port binding, no `initEventBridge()` call at module load.
  - `packages/studio/scripts/build-server.js` — bundles `bin.ts` to `dist-server/bin.js` alongside the library bundle.
  - `packages/studio/package.json` — `dev`/`start` scripts now point at `bin`.
  - `packages/cli/src/commands/dev.ts` — spawns `dist-server/bin.js` (or `src/server/bin.ts` in source mode) instead of `studio-server.js`.

  Local dev (`amodal dev`) behavior is unchanged. Library consumers no longer need the `import.meta.url` gate workaround.

- 9760d98: Add Studio connections management and expose directory-based connection credential metadata through the runtime API.
- Updated dependencies [9760d98]
- Updated dependencies [9760d98]
  - @amodalai/core@0.3.55
  - @amodalai/runtime@0.3.55
  - @amodalai/types@0.3.55
  - @amodalai/react@0.3.55
  - @amodalai/db@0.3.55

## 0.3.54

### Patch Changes

- 8879202: Don't auto-run `main()` in `studio-server.ts` when imported as a library.

  Library consumers (e.g. cloud-studio on Vercel) only want `createStudioApp` and the named hooks. The unconditional `main().catch(...)` at module-load tried to bind a TCP port, opened a Postgres LISTEN connection, and `process.exit(1)`d on failure — killing serverless functions before any request could be served. It also raced ahead of downstream `disableEventBridge()` calls, since LISTEN setup begins synchronously inside the importing module's body.

  Now gated by `import.meta.url === file://${process.argv[1]}` — `main()` only runs when this file is invoked directly (`node dist-server/studio-server.js`), preserving the existing local-dev behavior. Library imports are pure: nothing happens until the consumer calls `createStudioApp()`.

- 625ce54: Improve the Studio overview dashboard with per-agent operator metrics, recent activity, setup action items, connection health, model usage, and scoped usage breakdowns.
  - @amodalai/types@0.3.54
  - @amodalai/core@0.3.54
  - @amodalai/runtime@0.3.54
  - @amodalai/react@0.3.54
  - @amodalai/db@0.3.54

## 0.3.53

### Patch Changes

- 9e8fa6d: Ship type declarations for the `./server` subpath export.

  The `./server` entry was missing a `types` field in `package.json`, and the build only emitted declarations for `src/lib/`. Downstream packages importing from `@amodalai/studio/server` (e.g. cloud-studio) couldn't typecheck. Now `tsconfig.build.json` includes `src/server/`, the `./server` export points at `dist-server/src/server/studio-server.d.ts`, and `studio-server.ts` re-exports the missing public types (`StudioBackend`, `PreviewResult`, `WorkspaceFile`, batch types).

  Pure type-pipeline fix — no runtime changes.
  - @amodalai/types@0.3.53
  - @amodalai/core@0.3.53
  - @amodalai/runtime@0.3.53
  - @amodalai/react@0.3.53
  - @amodalai/db@0.3.53

## 0.3.52

### Patch Changes

- 2b49403: Add a Cost & Usage page with estimated spend by model, scope, and session.
- ce306ff: Add `setStudioDbProvider` and `disableEventBridge` hooks for serverless deployments.

  External deployments (e.g. cloud-studio on Vercel) can now inject a custom Drizzle db (e.g. neon-http-backed) instead of the default pg.Pool, and opt out of the Postgres LISTEN/NOTIFY real-time bridge in favor of their own pipeline (e.g. Pusher). `getStudioDb()` now uses the injected provider when present and falls back to the legacy pg.Pool + `ensureSchema` path otherwise. Routes that previously called `getDb()` directly (`admin-chat`, `repo-state`) now go through `getStudioDb()` so they also benefit from injection.

- b0e3a05: Refine Studio session list styling with a contrasted sidebar surface, page description copy, softer table chrome, compact model metadata, and subtler sortable headers.
- b0e3a05: Improve Studio session replay with clickable session rows, richer transcript rendering, session metadata, estimated cost, and persisted tool result details.
- b0e3a05: Reuse the React widget chat renderer for Studio session replay, show persisted tool results in widget tool-call details, and make Studio session table headers sortable.
- Updated dependencies [2b49403]
- Updated dependencies [b0e3a05]
- Updated dependencies [b0e3a05]
  - @amodalai/runtime@0.3.52
  - @amodalai/core@0.3.52
  - @amodalai/react@0.3.52
  - @amodalai/types@0.3.52
  - @amodalai/db@0.3.52

## 0.3.51

### Patch Changes

- 427bd23: Fix Skip-onboarding button — navigate back to the agent root after `init-repo` succeeds so IndexPage's `useRepoState` probe re-fires and routes to OverviewPage. Previously the button posted `init-repo` successfully but left the user stranded on `/setup` because the polling that would have swapped to OverviewPage doesn't run from that route post-v4.
  - @amodalai/types@0.3.51
  - @amodalai/core@0.3.51
  - @amodalai/runtime@0.3.51
  - @amodalai/react@0.3.51
  - @amodalai/db@0.3.51

## 0.3.50

### Patch Changes

- 1a0732b: Plumb marketplace card thumbnails (`imageUrl`) end-to-end so the chat-inline preview and the create-flow detail view both render the image when platform-api ships one.
  - `@amodalai/types` — `AgentCard` gains `imageUrl?: string` and makes `thumbnailConversation?` optional. The marketplace image is the canonical visual; the conversation snippet stays as a fallback for self-hosted/legacy templates.
  - `@amodalai/runtime` — `SSEShowPreviewEvent.card` mirror gains `imageUrl?` so the inline event carries the URL through unchanged. Drive-by: removed a duplicate `SSEShowPreviewEvent` declaration left over from a prior auto-merge.
  - `@amodalai/react` — `AgentCardInline` mirror gains `imageUrl?`. `<AgentCardInlinePreview>` renders the image as a small thumbnail when set (180w × 120h, 3:2 aspect — sits inside chat without dominating). The empty `__convo` div is now hidden when there are no thumbnail turns.
  - `@amodalai/studio` — `useTemplateCatalog` builds the agent card from platform-api fields including `cardImageUrl` (mapped to `card.imageUrl`); also synthesizes a partial `detail` from `longDescription` so the detail view renders real copy instead of a placeholder. `<AgentCard>` (gallery) renders the image as a 3:2 hero when present, falling back to the existing conversation block. `<DetailView>` (`CreateFlowPage`) leads with a hero image when set, plus shows the tagline as a subheading. `<PickerCard>` shows the image in place of the snippet block when present. Backend `template-resolve` route now reads `cardImageUrl` and `cardPlatforms` from platform-api and maps them onto the local `card` shape; the legacy `displayName` field still falls back to `name` so the inline preview no longer renders the slug as the title.

- 1a0732b: Add agent card foundations (Onboarding v4 — Phase 1).

  A template surfaces in the Studio gallery by shipping `card/card.json` (thumbnail) and optionally `card/preview.json` (expanded view) — a curated 2-4 turn conversation snippet that shows what the agent actually says, instead of a feature list.
  - `@amodalai/types` — `AgentCard`, `AgentCardPreview`, `AgentCardTurn` interfaces.
  - `@amodalai/core` — Zod schemas (`AgentCardSchema`, `AgentCardPreviewSchema`), parsers (`parseAgentCardJson`, `parseAgentCardPreviewJson`), and loaders (`loadAgentCard`, `loadAgentCardPreview`) that read from `<templateRoot>/card/`. Templates without a `card/` directory load as `null` rather than throwing.
  - `@amodalai/studio` — `<AgentCard>` presentational component (thumbnail + expanded variants) used by the gallery grid and inline in admin chat.

  No user-visible changes yet. Phase 2 (home screen) wires the renderer into routes and adds the `?featured=true` filter.

- 1a0732b: Add a "Getting started" tab, runtime OAuth broker, and per-connection configure pages.

  **Getting started tab** (`/agents/:agentId/getting-started`) — universal home for first-run agent configuration. Two render modes:
  - **Templated agent** (`template.json` exists in the repo) — slot-by-slot list with the curated providers from each `template.connections[]` slot.
  - **No template** — flat list of every connection package the agent has installed.

  Each row shows the package's `amodal.displayName` / icon / description, declared `auth.envVars` with per-var ✓/○, and a Connect button when OAuth is available. Backed by `GET /api/getting-started`.

  **Runtime-hosted OAuth broker** (`/api/oauth/{start,callback}`). When a package declares `amodal.oauth` and the user has set `<APPKEY>_CLIENT_ID` / `_CLIENT_SECRET` in env, the runtime brokers the redirect dance on the localhost loopback — no tunnel, no cloud dependency. Tokens persist to `<repoPath>/.amodal/secrets.env`, get pushed into `process.env`, and reload on every startup.

  **Per-connection configure page** (`/agents/:agentId/connections/:packageName`). Reached by clicking "Configure" on a Getting Started row. Renders different forms based on `auth.type`:
  - `bearer` / `api-key` → password input per envVar with description
  - `basic` → username + password (when declared)
  - OAuth-supported → Connect button + scopes preview alongside paste fallback
  - Anything else → generic per-envVar paste form

  Saves go through new `POST /api/secrets/:name` (writes to `secrets.env` + `process.env`). Backed by `GET /api/connections/:packageName` which returns the full `amodal.auth` block with `authType` + per-var status.

  Cloud uses the platform-api's broker instead — same protocol, different home.

- 1a0732b: Read marketplace card data straight from platform-api.

  The Studio gallery (home featured row + browse page) now reads card image, tagline, and platforms directly from `${registryUrl}/api/templates`. No more cross-origin GitHub fetch for `card/card.json` per template, no more stub-catalog fallback.
  - `AgentCard` interface gains `imageUrl?: string` and makes `thumbnailConversation?` optional. The `<AgentCard>` component renders the image when present and falls back to the legacy conversation block for self-hosted/legacy templates that still ship `card.json`.
  - `useTemplateCatalog` builds cards from the catalog response in one round-trip — no GitHub raw fetches, no stub fallback. Templates without an image still render (text-only card layout); empty registry surfaces honestly via the error string.
  - `<PickerCard>` renders the marketplace image when present; the snippet block is the fallback for image-less cards.
  - Deleted: `stub-catalog.ts` (~700 lines of in-memory marketplace data) and `template-card-fetcher.ts` (GitHub raw fetcher). The `parseCard` helper moved inline into `TemplateUpdatePage` (only remaining consumer — reads the installed package's local `card.json` for the update-diff page).

  Operationally requires platform-api at `api.amodalai.com` (or the configured `registryUrl`) to serve `cardImageUrl` for templates that have one. Templates without an image still appear in the picker; their cards render with title + tagline + platforms only.

- 1a0732b: Admin agent tools for the conversational setup flow (Onboarding v4 — Phase 4).

  **Five new admin-only tools** (gated by `sessionType === 'admin'`):
  - `show_preview` — emits an inline `show_preview` SSE event with a curated agent-card snippet. The admin agent leads with this when recommending a template.
  - `ask_choice` — emits a button-row question; the user's click posts the chosen value as the next user turn (no server round-trip).
  - `search_packages` — wraps `npm` registry search (`/-/v1/search`) for keyword-based discovery.
  - `install_package` — adds the package to `amodal.json#packages` and runs `npm install` in the agent repo.
  - `write_skill` — scaffolds a `skills/<name>/SKILL.md` with frontmatter, trigger, and methodology.

  **SSE event additions:**
  - `@amodalai/types` — `SSEEventType.AskChoice`, `SSEEventType.ShowPreview` plus matching event interfaces.
  - `@amodalai/runtime` — runtime mirrors the new event types and routes them through `ai-stream.ts`.
  - `@amodalai/react` — widget renders `show_preview` events as inline `<AgentCardInlinePreview>` cards and `ask_choice` events as `<AskChoiceCard>` button rows. New `submitAskChoiceResponse` callback on `useChat` posts the chosen value as the next user turn.

  **Tool-context plumbing:**
  - New `ctx.emit(event)` method on `ToolContext` lets tools push inline SSE events. Per-call `inlineEvents` sink is drained by the executing state and emitted before the `tool_call_result` event so the chat UI can render the card / buttons above the result block.

- 1a0732b: Studio home screen (Onboarding v4 — Phase 2).

  The agent index route (`/agents/:agentId/`) now opens to a home screen with three zones — featured agents, admin chat, and a "Browse all →" link to the gallery — instead of the model-pricing dashboard. The dashboard is still reachable at `/agents/:agentId/overview`.
  - New `<HomePage>` page in `src/pages/HomePage.tsx`.
  - New `useFeaturedAgents()` hook fetches `${registryUrl}/api/templates?featured=true` and resolves each template's `card/card.json` from GitHub raw. Templates without a card are silently dropped.
  - New `registryUrl` field on `StudioConfig`, defaulting to `https://api.amodalai.com`. Self-hosted instances override via `REGISTRY_URL`.
  - Sidebar gains a "Home" entry; the existing "Overview" link points at the dashboard.
  - Clicking "Use this →" on a card seeds the admin chat with `Set me up with the "<title>" template.` Phase 3 will replace this with an expanded preview page.

- 1a0732b: Lifecycle + power-user surfaces (Onboarding v4 — Phase 5).

  **View config toggle.** New toggle in `SystemPage` (localStorage-backed, off by default). When on, the sidebar surfaces the GettingStarted form and per-connection configure pages — the v4 home-first flow stays the user-facing default; ISVs and power users flip the bit when they need the underlying config UI back.

  **Template update notifications.**
  - New runtime endpoint `GET /api/package-updates` walks `amodal.json#packages`, reads each installed version from `node_modules/<pkg>/package.json`, runs `npm view <pkg> version` for the latest, and returns `{name, installed, latest, hasUpdate}` per package. Results are cached in-memory for 24 hours.
  - New `POST /api/package-updates/install` runs `npm install <pkg>@latest` and invalidates the cache.
  - New `GET /api/package-card?name=…` reads the installed `node_modules/<pkg>/card/card.json` for the diff page.
  - Studio polls on home-screen mount via `usePackageUpdates`. When any package has an update, an inline banner above the popular-agents row links to the diff page.

  **See-what-changed page** at `/agents/:agentId/updates/:slug`. Shows the package's currently-installed `card.json`, the version delta (installed → latest), and an "Update" button that POSTs the install. After install, the user is told to reload Studio to see the new card.

- 1a0732b: Studio template gallery (Onboarding v4 — Phase 3).

  Two new routes under `/agents/:agentId/`:
  - **`/browse`** — full marketplace gallery. Free-text search over title, tagline, platforms, and tags; category tabs derived from the catalog. Click a card to drill in.
  - **`/browse/:slug`** — template detail page. Two-column layout with the expanded preview (lazy-loaded from `card/preview.json`) on the left and the admin chat on the right. The chat is auto-seeded with `Set me up with the "<title>" template.` on mount so the user lands mid-conversation.

  Powered by a new `useTemplateCatalog()` hook that fetches the full marketplace and resolves each template's `card/card.json` from GitHub raw, mirroring the featured-only path. Card-fetch logic is now factored into `template-card-fetcher.ts` and shared with `useFeaturedAgents`.

  The chat seed is a placeholder — Phase 4 will replace it with a richer first config question once the admin agent has a `show_preview` tool.

- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
  - @amodalai/types@0.3.50
  - @amodalai/runtime@0.3.50
  - @amodalai/react@0.3.50
  - @amodalai/core@0.3.50
  - @amodalai/db@0.3.50

## 0.3.49

### Patch Changes

- @amodalai/types@0.3.49
- @amodalai/react@0.3.49
- @amodalai/db@0.3.49

## 0.3.48

### Patch Changes

- Updated dependencies [de7d384]
- Updated dependencies [1249171]
  - @amodalai/react@0.3.48
  - @amodalai/types@0.3.48
  - @amodalai/db@0.3.48

## 0.3.47

### Patch Changes

- 0cbf502: Show directory-based connections in Studio's connections page
- Updated dependencies [ed112ba]
  - @amodalai/react@0.3.47
  - @amodalai/types@0.3.47
  - @amodalai/db@0.3.47

## 0.3.46

### Patch Changes

- Updated dependencies [4be518d]
  - @amodalai/react@0.3.46
  - @amodalai/types@0.3.46
  - @amodalai/db@0.3.46

## 0.3.45

### Patch Changes

- 87f5214: Onboarding wizard, Studio proxy refactor, hot-reload improvements, admin agent tools
- Updated dependencies [2589dab]
- Updated dependencies [87f5214]
- Updated dependencies [054a9ce]
  - @amodalai/react@0.3.45
  - @amodalai/types@0.3.45
  - @amodalai/db@0.3.45

## 0.3.44

### Patch Changes

- e99a932: Studio sidebar reorg, dashboard with cost tracking, sessions page, incremental text streaming, markdown fix, CLI port flags
- Updated dependencies [8909a18]
- Updated dependencies [e99a932]
  - @amodalai/react@0.3.44
  - @amodalai/db@0.3.44

## 0.3.43

### Patch Changes

- 6dcaf1c: Fix static asset MIME types when BASE_PATH is set by excluding /assets/ paths from the SPA catch-all route
  - @amodalai/react@0.3.43
  - @amodalai/db@0.3.43

## 0.3.42

### Patch Changes

- fa9d31a: Fix Studio asset paths when served under BASE_PATH

  The pre-built Studio has asset paths baked with `base: '/'` by Vite. When served under a subpath like `/studio/`, CSS and JS failed to load. Now the server rewrites `href="/"` and `src="/"` in the HTML to include the base path prefix at serve time.
  - @amodalai/react@0.3.42
  - @amodalai/db@0.3.42

## 0.3.41

### Patch Changes

- b4d056c: Add a "Getting started" tab, runtime OAuth broker, and per-connection configure pages.

  **Getting started tab** (`/agents/:agentId/getting-started`) — universal home for first-run agent configuration. Two render modes:
  - **Templated agent** (`template.json` exists in the repo) — slot-by-slot list with the curated providers from each `template.connections[]` slot.
  - **No template** — flat list of every connection package the agent has installed.

  Each row shows the package's `amodal.displayName` / icon / description, declared `auth.envVars` with per-var ✓/○, and a Connect button when OAuth is available. Backed by `GET /api/getting-started`.

  **Runtime-hosted OAuth broker** (`/api/oauth/{start,callback}`). When a package declares `amodal.oauth` and the user has set `<APPKEY>_CLIENT_ID` / `_CLIENT_SECRET` in env, the runtime brokers the redirect dance on the localhost loopback — no tunnel, no cloud dependency. Tokens persist to `<repoPath>/.amodal/secrets.env`, get pushed into `process.env`, and reload on every startup.

  **Per-connection configure page** (`/agents/:agentId/connections/:packageName`). Reached by clicking "Configure" on a Getting Started row. Renders different forms based on `auth.type`:
  - `bearer` / `api-key` → password input per envVar with description
  - `basic` → username + password (when declared)
  - OAuth-supported → Connect button + scopes preview alongside paste fallback
  - Anything else → generic per-envVar paste form

  Saves go through new `POST /api/secrets/:name` (writes to `secrets.env` + `process.env`). Backed by `GET /api/connections/:packageName` which returns the full `amodal.auth` block with `authType` + per-var status.

  Cloud uses the platform-api's broker instead — same protocol, different home.

- f235fee: Add BASE_PATH support to Studio for subpath deployments

  Studio can now be mounted at a subpath (e.g., `/studio/`) via the `BASE_PATH` env var. Server routes, Vite asset paths, and frontend API calls all respect the prefix. Default is empty string (root), preserving existing behavior.
  - @amodalai/react@0.3.41
  - @amodalai/db@0.3.41

## 0.3.40

### Patch Changes

- Updated dependencies [9a6f63a]
  - @amodalai/react@0.3.40
  - @amodalai/db@0.3.40

## 0.3.39

### Patch Changes

- @amodalai/react@0.3.39
- @amodalai/db@0.3.39

## 0.3.38

### Patch Changes

- d215ab5: Rebrand from blue to teal accent colors and update logo to new geometric "A" mark
- Updated dependencies [d215ab5]
  - @amodalai/react@0.3.38
  - @amodalai/db@0.3.38

## 0.3.37

### Patch Changes

- @amodalai/react@0.3.37
- @amodalai/db@0.3.37

## 0.3.36

### Patch Changes

- 701b5d0: Fix evals and wire arena backend
  - Fix eval runner SSE parsing (was trying to JSON.parse an SSE stream)
  - Add POST /api/evals/run endpoint to runtime for arena eval execution
  - Fix GET /api/evals/arena/models to return configured models from agent config
  - @amodalai/react@0.3.36
  - @amodalai/db@0.3.36

## 0.3.35

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.35
  - @amodalai/db@0.3.35

## 0.3.34

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.34
  - @amodalai/db@0.3.34

## 0.3.33

### Patch Changes

- [#280](https://github.com/amodalai/amodal/pull/280) [`950632b`](https://github.com/amodalai/amodal/commit/950632bfd09da62d3eed42805c77d183a0f2dba8) Thanks [@gte620v](https://github.com/gte620v)! - Fix admin chat 404 — server route path didn't match frontend request

  The frontend calls `/api/studio/admin-chat/stream` but the server route was registered at `/api/admin-chat/stream`. Updated the route to match.

- Updated dependencies []:
  - @amodalai/react@0.3.33
  - @amodalai/db@0.3.33

## 0.3.32

### Patch Changes

- [#278](https://github.com/amodalai/amodal/pull/278) [`3639576`](https://github.com/amodalai/amodal/commit/3639576b10e81f11ca90f7bad6dae9ce71dd3fee) Thanks [@gte620v](https://github.com/gte620v)! - Fix Studio not reachable in Docker/container environments

  Studio server was hardcoded to bind to `localhost`, making it unreachable via Docker port forwarding. Now binds to `0.0.0.0` when launched by `amodal dev`.

- Updated dependencies []:
  - @amodalai/react@0.3.32
  - @amodalai/db@0.3.32

## 0.3.31

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.31
  - @amodalai/db@0.3.31

## 0.3.30

### Patch Changes

- [#271](https://github.com/amodalai/amodal/pull/271) [`d820a7d`](https://github.com/amodalai/amodal/commit/d820a7dcd5512ac75e5891ba899ab895960c5aea) Thanks [@gte620v](https://github.com/gte620v)! - Fix Studio not loading after npm install

  Studio's package.json exports field didn't expose `./package.json`,
  so `require.resolve('@amodalai/studio/package.json')` failed when
  the CLI tried to locate the Studio package. This caused Studio to
  silently skip on every `amodal dev` run from an npm-installed CLI.

- [#272](https://github.com/amodalai/amodal/pull/272) [`3ea984e`](https://github.com/amodalai/amodal/commit/3ea984e4384142e225e8176469fb9db56437fa84) Thanks [@gte620v](https://github.com/gte620v)! - Clean up code comments that referenced ephemeral project state (phase/workstream/roadmap labels, gotcha indexes, "replaces upstream X" lineage, refactor code-names, PR numbers). No functional changes — comment-only edits so future readers see what the code is and does, not the project timeline that produced it.

- Updated dependencies [[`3ea984e`](https://github.com/amodalai/amodal/commit/3ea984e4384142e225e8176469fb9db56437fa84)]:
  - @amodalai/db@0.3.30
  - @amodalai/react@0.3.30

## 0.3.29

### Patch Changes

- Updated dependencies [[`2e1974b`](https://github.com/amodalai/amodal/commit/2e1974b2f3852efab849710856420cd4198347ae)]:
  - @amodalai/react@0.3.29
  - @amodalai/db@0.3.29

## 0.3.28

### Patch Changes

- Updated dependencies [[`2b135e6`](https://github.com/amodalai/amodal/commit/2b135e6c5ece03d722d6018ca4a6f3faebbdc17d)]:
  - @amodalai/db@0.3.28
  - @amodalai/react@0.3.28

## 0.3.27

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.27
  - @amodalai/db@0.3.27

## 0.3.26

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.26
  - @amodalai/db@0.3.26

## 0.3.25

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.25
  - @amodalai/db@0.3.25

## 0.3.24

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.24
  - @amodalai/db@0.3.24

## 0.3.23

### Patch Changes

- Updated dependencies [[`c1e515b`](https://github.com/amodalai/amodal/commit/c1e515b81cbb286b2b6f99d39f29eeca08bc8621)]:
  - @amodalai/db@0.3.23
  - @amodalai/react@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.22
  - @amodalai/db@0.3.22

## 0.3.21

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.3.21
  - @amodalai/db@0.3.21

## 0.3.20

### Patch Changes

- [#242](https://github.com/amodalai/amodal/pull/242) [`abb3c8f`](https://github.com/amodalai/amodal/commit/abb3c8f48e546262edb1faeafb6fed05f5199d86) Thanks [@gte620v](https://github.com/gte620v)! - Reconcile ChatWidget and ChatPage: add markdown rendering (react-markdown), image paste, confirmation cards, feedback buttons, and elapsed timer to ChatWidget. Replace runtime-app's custom ChatPage with thin wrapper around ChatWidget. Replace Studio's AdminChat with ChatWidget (custom streamFn support). Delete Studio's duplicate ToolCallCard. Add shared FormattedMarkdown component.

- Updated dependencies [[`abb3c8f`](https://github.com/amodalai/amodal/commit/abb3c8f48e546262edb1faeafb6fed05f5199d86)]:
  - @amodalai/react@0.3.20
  - @amodalai/db@0.3.20

## 0.3.19

### Patch Changes

- [#240](https://github.com/amodalai/amodal/pull/240) [`5084027`](https://github.com/amodalai/amodal/commit/508402711590335360b71b49b391a5448427248c) Thanks [@whodatdev](https://github.com/whodatdev)! - Cloud compatibility fixes: decode URI-encoded paths in extractWildcard, make preview injectable via setPreviewHandler(), support branch-based preview in DraftWorkspaceBar.

- Updated dependencies []:
  - @amodalai/react@0.3.19
  - @amodalai/db@0.3.19

## 0.3.18

### Patch Changes

- Updated dependencies [[`b8a6c07`](https://github.com/amodalai/amodal/commit/b8a6c07554c31fe2be96e50b5d34409d9877caf6)]:
  - @amodalai/db@0.3.18
  - @amodalai/react@0.3.18

## 0.3.17

### Patch Changes

- [#236](https://github.com/amodalai/amodal/pull/236) [`25c47c8`](https://github.com/amodalai/amodal/commit/25c47c802e2345f039ff47a44545d6651f19ad0b) Thanks [@whodatdev](https://github.com/whodatdev)! - Read eval suite definitions from the runtime's file tree instead of loading them into Postgres at startup. Eval runs still persist to Postgres.

- Updated dependencies []:
  - @amodalai/react@0.3.17
  - @amodalai/db@0.3.17

## 0.3.16

### Patch Changes

- [#234](https://github.com/amodalai/amodal/pull/234) [`6a5a0a4`](https://github.com/amodalai/amodal/commit/6a5a0a43db3fab70ec622086a1ebe97073a87931) Thanks [@whodatdev](https://github.com/whodatdev)! - Read eval suite definitions from the runtime's file tree instead of loading them into Postgres at startup. Eval runs still persist to Postgres.

- Updated dependencies []:
  - @amodalai/react@0.3.16
  - @amodalai/db@0.3.16

## 0.3.15

### Patch Changes

- [#232](https://github.com/amodalai/amodal/pull/232) [`aa1c86f`](https://github.com/amodalai/amodal/commit/aa1c86ff8f372b40b4de41ffdfa10bf7c9cfbe88) Thanks [@whodatdev](https://github.com/whodatdev)! - Fix file editor to call runtime directly instead of using the `/api/runtime/files` proxy route. The proxy only works in local dev — in cloud deployments, the SPA's fetch patch rewrites it to the wrong host. Now uses `runtimeUrl` from config, matching how the agent inventory hook already works.

- Updated dependencies []:
  - @amodalai/react@0.3.15
  - @amodalai/db@0.3.15

## 0.3.14

### Patch Changes

- [#230](https://github.com/amodalai/amodal/pull/230) [`7acb27e`](https://github.com/amodalai/amodal/commit/7acb27e3cc229a98aadac336236bc03d11eb48df) Thanks [@whodatdev](https://github.com/whodatdev)! - Migrate Studio server from Express to Hono. Hono is 14KB (vs Express 200KB+), has zero dependencies, built-in TypeScript types, and native support for serverless platforms (Vercel, Cloudflare Workers). The `BackendFactory` and `StudioAuth` types now accept the web standard `Request` instead of Express `Request`, making the hooks platform-agnostic.

- Updated dependencies []:
  - @amodalai/react@0.3.14
  - @amodalai/db@0.3.14

## 0.3.13

### Patch Changes

- [#226](https://github.com/amodalai/amodal/pull/226) [`118ba94`](https://github.com/amodalai/amodal/commit/118ba94ef2c2edd7c69a37bd1f52661c228816ac) Thanks [@gte620v](https://github.com/gte620v)! - Re-export setAuthProvider, setBackendFactory, DrizzleStudioBackend, and
  other lib functions from the ./server entry point so cloud-studio can
  import everything from one working esbuild bundle.
- Updated dependencies []:
  - @amodalai/react@0.3.13
  - @amodalai/db@0.3.13

## 0.3.12

### Patch Changes

- [#223](https://github.com/amodalai/amodal/pull/223) [`470e205`](https://github.com/amodalai/amodal/commit/470e205075257cd6a9f20ca5c7e8cff4d0f03f0e) Thanks [@gte620v](https://github.com/gte620v)! - Re-export lib functions from ./server entry point for cloud-studio

  The ./server export now re-exports setAuthProvider, setBackendFactory,
  DrizzleStudioBackend, logger, and error classes so cloud-studio can
  import everything from one working esbuild bundle entry point.

- Updated dependencies []:
  - @amodalai/react@0.3.12
  - @amodalai/db@0.3.12

## 0.3.11

### Patch Changes

- [#212](https://github.com/amodalai/amodal/pull/212) [`2687d26`](https://github.com/amodalai/amodal/commit/2687d2684a75868ce7d89fd1b0b2aad3cb7da6b7) Thanks [@gte620v](https://github.com/gte620v)! - Add databaseUrl option to DrizzleStudioBackend for cloud multi-tenant usage

  Cloud-studio needs to create per-request backends scoped to different
  agent databases. The new optional `databaseUrl` constructor parameter
  overrides the `DATABASE_URL` env var, enabling the `setBackendFactory()`
  hook to connect to the correct per-agent Neon database.

- Updated dependencies []:
  - @amodalai/react@0.3.11
  - @amodalai/db@0.3.11

## 0.3.10

### Patch Changes

- [#219](https://github.com/amodalai/amodal/pull/219) [`795fbcb`](https://github.com/amodalai/amodal/commit/795fbcb6ae15915dc90c9ac34f9047ee7bc63a3a) Thanks [@whodatdev](https://github.com/whodatdev)! - Ship `src/` in the published package and add subpath exports for the App component, events context, config context, and styles. Allows external deployments to Vite-build their own SPA entry point that wraps the OSS Studio App with custom providers.

- Updated dependencies []:
  - @amodalai/react@0.3.10
  - @amodalai/db@0.3.10

## 0.3.9

### Patch Changes

- [#217](https://github.com/amodalai/amodal/pull/217) [`08036ef`](https://github.com/amodalai/amodal/commit/08036ef84100310124f2a52d0e7810d1ce59fdc2) Thanks [@whodatdev](https://github.com/whodatdev)! - Export the events context, types, and hook from StudioEventsContext so external deployments can provide their own real-time events implementation. Make the App component accept an optional `eventsProvider` prop to swap the default SSE provider.

- Updated dependencies []:
  - @amodalai/react@0.3.9
  - @amodalai/db@0.3.9

## 0.3.8

### Patch Changes

- [#215](https://github.com/amodalai/amodal/pull/215) [`1a17706`](https://github.com/amodalai/amodal/commit/1a177063cffe0d11417b09ceccf35bd69f986199) Thanks [@whodatdev](https://github.com/whodatdev)! - Add lib type declarations to the published package. The build now runs tsc alongside esbuild so `dist-server/` contains both the bundled server JS and `.d.ts` files for the lib barrel. Adds `main`, `types`, and `exports` fields to package.json so `import { ... } from '@amodalai/studio'` resolves types correctly.

- Updated dependencies []:
  - @amodalai/react@0.3.8
  - @amodalai/db@0.3.8

## 0.3.7

### Patch Changes

- [#213](https://github.com/amodalai/amodal/pull/213) [`9190ac3`](https://github.com/amodalai/amodal/commit/9190ac30540d7d2991c17b555f9c4ea8b2011607) Thanks [@whodatdev](https://github.com/whodatdev)! - Extract `createStudioApp()` from the Studio server entry point. Returns the Express app with all middleware and routes mounted but without calling `listen()`. Allows external deployments to use Studio as a serverless handler or embed it in a custom server.

- Updated dependencies []:
  - @amodalai/react@0.3.7
  - @amodalai/db@0.3.7

## 0.3.6

### Patch Changes

- [#209](https://github.com/amodalai/amodal/pull/209) [`8b8e310`](https://github.com/amodalai/amodal/commit/8b8e3102f679d89939015f6698bb014a64b09d35) Thanks [@gte620v](https://github.com/gte620v)! - Fix file editor crash and draft workspace API calls
  - listDrafts: API returns `{ drafts: [] }` not bare array — fix deserialization
  - saveDraft: put file path in URL (`PUT /drafts/{path}`) not request body
  - discardAll: use `POST /discard` endpoint, not `DELETE /drafts`

- Updated dependencies []:
  - @amodalai/react@0.3.6
  - @amodalai/db@0.3.6

## 0.3.5

### Patch Changes

- [#207](https://github.com/amodalai/amodal/pull/207) [`291e0da`](https://github.com/amodalai/amodal/commit/291e0dab26cc9a184d57c29c86a5d4deae8bdab2) Thanks [@gte620v](https://github.com/gte620v)! - Fix Studio pages to match v0.2.x runtime-app features

  Port pricing table, model arena, token breakdown, markdown rendering, admin
  chat panel, eval loading, and correct runtime API field mappings from the old
  runtime-app into Studio.

- Updated dependencies []:
  - @amodalai/react@0.3.5
  - @amodalai/db@0.3.5

## 0.3.4

### Patch Changes

- [#204](https://github.com/amodalai/amodal/pull/204) [`5e0e062`](https://github.com/amodalai/amodal/commit/5e0e0627b920845645e8a741febe5d6358692b08) Thanks [@whodatdev](https://github.com/whodatdev)! - Fix lib build by replacing Next.js-only `cache: 'no-store'` fetch option with `next: { revalidate: 0 }` in runtime-client. The previous option doesn't exist on the standard Node.js RequestInit type, causing tsc --build to fail and publishing an empty dist/.

- [#206](https://github.com/amodalai/amodal/pull/206) [`988bb5e`](https://github.com/amodalai/amodal/commit/988bb5ec9995f3dbc53087b9a61063fe18fefaf0) Thanks [@gte620v](https://github.com/gte620v)! - Replace Next.js with Vite SPA + Express server

  Studio no longer depends on Next.js. The UI is now a Vite-built SPA and the backend is a lightweight Express server bundled with esbuild. This fixes the SWC binary resolution issue that broke Studio when installed via `npm install -g @amodalai/amodal`.
  - Package size: 396 KB compressed (was ~37 MB with Next.js standalone)
  - Server startup: ~25ms (was ~3s with `next dev`)
  - No native binaries, no SWC, no platform-specific dependencies
  - Local dev preserved: `tsx src/server/studio-server.ts` with Vite dev proxy
  - Architecture unchanged: Studio remains a separate process from Runtime

- Updated dependencies []:
  - @amodalai/db@0.3.4

## 0.3.3

### Patch Changes

- [#202](https://github.com/amodalai/amodal/pull/202) [`80ebcd7`](https://github.com/amodalai/amodal/commit/80ebcd743eaa0b2785be866d0a7f484c78c5828a) Thanks [@whodatdev](https://github.com/whodatdev)! - Publish @amodalai/studio as a public package. Add `setBackendFactory()` and `setAuthProvider()` extension points so external deployments can inject per-request backends and custom auth. Add barrel export for lib modules (backend interface, types, auth/startup hooks, errors, draft-path validation). Update all route handlers to pass request to `getBackend(req)` for factory resolution.

- Updated dependencies []:
  - @amodalai/db@0.3.3

## 0.3.2

### Patch Changes

- [#200](https://github.com/amodalai/amodal/pull/200) [`4656b2e`](https://github.com/amodalai/amodal/commit/4656b2eb34a5658fd59b64d2e85f937a3e283a38) Thanks [@gte620v](https://github.com/gte620v)! - Ship Studio with the CLI so `npm install -g @amodalai/amodal` gives
  users the full stack. `amodal dev` now starts runtime + Studio +
  admin agent without any extra install steps.
  - Removed `"private": true` from `@amodalai/studio` so it publishes
    to npm alongside the other packages.
  - Added `"@amodalai/studio": "workspace:*"` as a dependency of
    `@amodalai/amodal` (the CLI) so npm pulls it transitively.
  - Added `@amodalai/studio` to the changeset fixed lockstep group and
    bumped its version to 0.3.1 to match the rest of the group.
  - Added a `"files"` field to Studio's package.json so only the source
    files needed by `next dev` ship in the npm tarball (src, public,
    next.config.ts, postcss.config.cjs, tailwind.config.ts, tsconfig.json).

- Updated dependencies []:
  - @amodalai/db@0.3.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`9833d69`](https://github.com/amodalai/amodal/commit/9833d696fb641d08f39fc3296f49a61c04350fe2)]:
  - @amodalai/db@0.3.1

## 0.1.0

### Minor Changes

- [#194](https://github.com/amodalai/amodal/pull/194) [`13723ff`](https://github.com/amodalai/amodal/commit/13723ff5be1e9983a1a66c697ec352d3a2dbfcd7) Thanks [@gte620v](https://github.com/gte620v)! - Studio standalone: separate Studio into its own Next.js service, strip admin code from runtime, add workspace tools, update CLI to spawn Studio + admin agent subprocesses
