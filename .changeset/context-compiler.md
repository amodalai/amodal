---
"@amodalai/runtime": patch
---

Add standalone context compiler (Phase 3.2)

Extracts system prompt compilation into `packages/runtime/src/context/compiler.ts` — a single module that takes raw agent config (connections, skills, knowledge, stores) and produces the complete system prompt. Handles field guidance generation, scope label resolution, alternative lookup guidance, and store schema rendering internally. Replaces the scattered `buildDefaultPrompt()` assembly logic in session-manager and inspect routes.
