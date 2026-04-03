---
"@amodalai/runtime": patch
---

Add custom tool adapter for new ToolRegistry (Phase 2.4). Converts LoadedTool instances to ToolDefinition objects with Zod schemas, typed errors, and full CustomToolContext (request, store, exec, env, log). Dual-writes to both upstream and new registries during migration.
