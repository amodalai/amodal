---
"@amodalai/studio": patch
---

Add `setStudioDbProvider` and `disableEventBridge` hooks for serverless deployments.

External deployments (e.g. cloud-studio on Vercel) can now inject a custom Drizzle db (e.g. neon-http-backed) instead of the default pg.Pool, and opt out of the Postgres LISTEN/NOTIFY real-time bridge in favor of their own pipeline (e.g. Pusher). `getStudioDb()` now uses the injected provider when present and falls back to the legacy pg.Pool + `ensureSchema` path otherwise. Routes that previously called `getDb()` directly (`admin-chat`, `repo-state`) now go through `getStudioDb()` so they also benefit from injection.
