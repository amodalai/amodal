---
"@amodalai/studio": patch
---

Pass the incoming `Request` to `getBackend()` in every route handler that uses it.

`getBackend()` is documented as supporting per-request backend resolution: when a `BackendFactory` is registered (via `setBackendFactory`), the factory is called with the request and can read auth headers, claims, etc. to scope the backend to the current agent. Several route handlers — `drafts.ts`, `publish.ts`, `discard.ts`, `workspace.ts`, `embed-config.ts` — were calling `getBackend()` with no arguments, which threw `BackendFactory is set but no request was provided to getBackend()` for any deployment that uses the factory hook (cloud-studio).

All of these now pass `c.req.raw` (or in the case of `embed-config.ts`'s shared `readCurrentConfig` helper, the request is threaded through). Local-dev with the singleton fallback path is unaffected.
