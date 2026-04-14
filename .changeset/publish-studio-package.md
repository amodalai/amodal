---
"@amodalai/studio": patch
---

Publish @amodalai/studio as a public package. Add `setBackendFactory()` and `setAuthProvider()` extension points so external deployments can inject per-request backends and custom auth. Add barrel export for lib modules (backend interface, types, auth/startup hooks, errors, draft-path validation). Update all route handlers to pass request to `getBackend(req)` for factory resolution.
