# @amodalai/studio

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
