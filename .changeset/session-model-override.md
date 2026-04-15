---
"@amodalai/runtime": patch
---

Add session-level model override to POST /chat

Accepts an optional `model: { provider, model }` field in the chat request
body. When set, the session uses the specified model instead of the agent's
configured default. This enables evals and arena to run the same input
against different models by creating separate sessions with different
model overrides.
