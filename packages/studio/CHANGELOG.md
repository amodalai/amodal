# @amodalai/studio

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
