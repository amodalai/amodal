# @amodalai/studio

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
