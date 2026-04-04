---
"@amodalai/runtime": minor
"@amodalai/types": minor
---

Add runtime event bus for push-based UI updates.

The runtime now emits typed lifecycle events (session_created/updated/deleted,
automation_triggered/completed/failed, manifest_changed, files_changed) on an
internal `RuntimeEventBus`. Events are streamed to clients over a new
`/api/events` SSE endpoint.

Clients connect once via EventSource and receive every state change in real
time. Replaces `setInterval` polling in the runtime-app for session list,
automation status, manifest reloads, file tree, and health checks. The UI now
updates the instant something changes instead of on 3-10 second cycles.

The bus buffers the last 200 events and supports `Last-Event-ID` for
reconnect-and-resume, so clients never miss state changes across brief
disconnects.

New public types: `RuntimeEvent`, `RuntimeEventType`, `RuntimeEventPayload`.
