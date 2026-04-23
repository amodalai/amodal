---
"@amodalai/amodal": patch
"@amodalai/studio": patch
---

Fix Studio not reachable in Docker/container environments

Studio server was hardcoded to bind to `localhost`, making it unreachable via Docker port forwarding. Now binds to `0.0.0.0` when launched by `amodal dev`.
