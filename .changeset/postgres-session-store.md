---
"@amodalai/runtime": patch
---

Add `PostgresSessionStore` for production session persistence.

Completes the "no PGLite in production" story started in #146. Any ISV
embedding `@amodalai/runtime` can now point session persistence at a
real Postgres database by setting `stores.backend: 'postgres'` and
`stores.postgresUrl` in `amodal.json`. PGLite remains the default for
`amodal dev` — zero config unchanged.

**New surface:**

- `PostgresSessionStore` class and `createPostgresSessionStore()` factory
  (accepts either a `connectionString` or an existing `pg.Pool`).
- `SessionStoreHooks` — optional `onAfterSave` / `onAfterDelete` /
  `onAfterCleanup` callbacks, awaited on the write path. Intended for
  dual-write, observability, or cache invalidation.
- `SessionListOptions` — cursor pagination, metadata JSONB filters,
  `updatedAfter` / `updatedBefore` date range.
- `SessionStoreError` typed error for module-boundary failures.
- `selectSessionStore()` helper used by `local-server.ts` to pick the
  backend. Falls back to PGLite if `postgres` is configured but the URL
  is missing — the session store must always be available.

**Interface change:** `SessionStore.list()` now returns
`{sessions, nextCursor}` instead of `PersistedSession[]`. Internal only —
not publicly exported via `@amodalai/runtime`.
