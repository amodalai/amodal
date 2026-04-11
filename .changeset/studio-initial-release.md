---
"@amodalai/studio": patch
---

Initial release of `@amodalai/studio` — the draft workspace backend
for amodal's editor. Part of the vercel-shaped refactor (WS2).

Contents:

- `StudioBackend` interface — backend-agnostic draft workspace contract
  (getDraft / setDraft / deleteDraft / listDrafts / discardAll /
  publish / buildPreview). Used by both `amodal dev` locally and
  amodal cloud, with different backend implementations injected at
  each layer.
- `PGLiteStudioBackend` — local-dev implementation backed by pglite.
  Stores drafts in a `studio_drafts` table keyed by `(user_id,
file_path)`. Publish writes drafts directly to the local repo
  filesystem (no git in local dev).
- `createStudioRouter` — Express router mounting `/api/studio/*`
  endpoints (drafts list, save, delete, discard, publish, preview)
  against an injected backend. Role-gated via a `StudioAuth`
  interface that adapters translate to from the hosting layer's
  existing auth (e.g. runtime's `RoleProvider`).
- `NotImplementedStudioBackend` — throw-all placeholder for callers
  that need a concrete class before the real backends land.
- `backend-contract.ts` — reusable contract test suite that every
  backend implementation must pass. Shared between the local pglite
  backend and the forthcoming cloud Drizzle backend.

Not yet in this release: the Drizzle cloud backend
(cloud/packages/platform-api) or the final editor UI wiring. Those
land in subsequent WS2 PRs once this package is publishable and
cloud can pin to it.
