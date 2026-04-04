---
"@amodalai/runtime": patch
---

Migrate PGLite store backend to Drizzle ORM and add Postgres backend (Phase 4.3b)

The PGLite store backend is now implemented on top of Drizzle ORM instead of raw SQL. A new Postgres backend (`createPostgresStoreBackend`) shares the same query layer and schema, enabling hosted runtimes to swap backends without changing behaviour. Both backends share `storeDocuments` and `storeDocumentVersions` tables defined in the shared Drizzle schema. Store-backend errors now throw typed `StoreError` instances instead of being swallowed and returned as `null`/empty results.
