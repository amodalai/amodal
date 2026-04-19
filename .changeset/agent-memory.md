---
"@amodalai/db": patch
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Add agent memory: per-instance persistent memory with update_memory tool

Adds the Phase 1 memory feature: a single-row text blob per database that the agent
reads from its system prompt and updates via the built-in `update_memory` tool.

- New `agent_memory` table in `@amodalai/db` schema and migration
- `memory` config block (`enabled`, `editableBy`) in amodal.json
- Memory section in the context compiler (between knowledge and stores)
- `update_memory` tool registered when memory is enabled and editable
- Memory management instructions injected into the system prompt
