---
"@amodalai/runtime": patch
---

Rewrite chat routes to use StandaloneSessionManager (Phase 3.5c)

- New `chat-stream.ts`, `ai-stream.ts`, `chat.ts` routes use `StandaloneSessionManager` + `buildSessionComponents()` instead of the legacy `SessionManager`
- New `session-resolver.ts` extracts shared session resolution logic (bundle resolution, session lookup/resume/create)
- Add hydration deduplication to `StandaloneSessionManager.resume()` via `pendingResumes` map
- Legacy route files preserved as `*-legacy.ts` for `server.ts`/`local-server.ts`/`snapshot-server.ts` until Phase 3.5e rewrites the server lifecycle
- Export `StandaloneSessionManager`, `resolveSession`, `resolveBundle`, `BundleResolver`, `SharedResources` from runtime package
