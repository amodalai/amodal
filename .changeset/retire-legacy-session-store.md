---
"@amodalai/runtime": patch
---

Retire the legacy file-based `SessionStore` (`.amodal/sessions/*.json`).

The dev-UI session history routes in `local-server.ts` (`GET /sessions`,
`GET /session/:id`, `PATCH /session/:id`, `DELETE /session/:id`, and
`resumeSessionId: 'latest'`) now read and write through the
`DrizzleSessionStore` that was already handling session resume. This
removes the dual-persistence path that held overlapping data in two
stores.

**Behavioural changes:**

- Chat sessions no longer write to `.amodal/sessions/` — they only land
  in PGLite (or Postgres). The dev UI reads from the same store.
- Session metadata now carries `appId` so list queries can filter out
  eval-runner / admin sessions via `metadata.appId = 'local'`.
- Automation session history is tagged via `metadata.automationName`
  (set in the proactive-runner `onSessionComplete` hook), preserving
  the `/sessions?automation=<name>` filter used by the automation
  detail page.
- Session titles (set via `PATCH /session/:id`) live on
  `metadata.title` and persist through `sessionManager.persist()`.

Existing `.amodal/sessions/*.json` files are orphaned and can be
deleted — they are no longer read.
