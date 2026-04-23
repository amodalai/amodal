---
"@amodalai/studio": patch
---

Fix admin chat 404 — server route path didn't match frontend request

The frontend calls `/api/studio/admin-chat/stream` but the server route was registered at `/api/admin-chat/stream`. Updated the route to match.
