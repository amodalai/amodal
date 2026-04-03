---
"@amodalai/runtime": patch
---

Add custom tool adapter for new ToolRegistry (Phase 2.4). Converts LoadedTool instances to ToolDefinition objects using AI SDK jsonSchema() for proper LLM parameter schemas, typed errors, and full CustomToolContext (request, store, exec, env, log).
