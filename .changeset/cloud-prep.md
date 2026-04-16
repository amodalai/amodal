---
"@amodalai/studio": patch
---

Add databaseUrl option to DrizzleStudioBackend for cloud multi-tenant usage

Cloud-studio needs to create per-request backends scoped to different
agent databases. The new optional `databaseUrl` constructor parameter
overrides the `DATABASE_URL` env var, enabling the `setBackendFactory()`
hook to connect to the correct per-agent Neon database.
