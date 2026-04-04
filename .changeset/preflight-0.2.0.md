---
"@amodalai/runtime": patch
---

Pre-release fixes for 0.2.0:

- Fix chat sessions not appearing in `/sessions` endpoint. The `onSessionPersist`
  stream hook now mirrors the session to the legacy file-based `SessionStore`
  (read by the UI history panel) alongside the PGLite write. Mirror write is
  wrapped in try/catch with `log.warn` — PGLite remains the source of truth,
  so a mirror failure doesn't break the route after the response has drained.
- Fix `buildPages()` crashing on relative `repoPath`. The generated wrapper
  `.tsx` lives in `.amodal/pages-build/` and imports the page entry by path;
  esbuild can't resolve that import if the path is relative. Now resolves
  to absolute at the top of the function.
- Forward `ConfirmationRequired`, `CompactionStart`/`End`, and `ToolLog` SSE
  events to the AI SDK UI stream as `data-*` events. Previously dropped.
  Remaining event types (explore, plan mode, field scrub) are explicitly
  dropped; the switch is now exhaustive.
- Wrap all 20 async Express route handlers with `asyncHandler()` so rejected
  promises propagate to the error middleware instead of hanging the request.
  New `asyncHandler` helper in `routes/route-helpers.ts`.
