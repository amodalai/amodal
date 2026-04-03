---
"@amodalai/runtime": patch
---

Replace Zod round-trip in MCP tool adapter with AI SDK jsonSchema() passthrough. MCP tool parameter schemas now pass through to the LLM unchanged, preserving all descriptions, types, and constraints. Removes 120 lines of jsonSchemaToZod conversion code.
