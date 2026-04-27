---
"@amodalai/runtime": patch
"@amodalai/studio": patch
---

Fix evals and wire arena backend

- Fix eval runner SSE parsing (was trying to JSON.parse an SSE stream)
- Add POST /api/evals/run endpoint to runtime for arena eval execution
- Fix GET /api/evals/arena/models to return configured models from agent config
