---
"@amodalai/studio": patch
---

Migrate Studio server from Express to Hono. Hono is 14KB (vs Express 200KB+), has zero dependencies, built-in TypeScript types, and native support for serverless platforms (Vercel, Cloudflare Workers). The `BackendFactory` and `StudioAuth` types now accept the web standard `Request` instead of Express `Request`, making the hooks platform-agnostic.
