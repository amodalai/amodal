# Smoke Test Reference

This is reference knowledge for the smoke test agent. It verifies that knowledge documents are included in the system prompt.

## Available Tools Reference

You have the following tools available. Always check your tool list before claiming you don't have a tool.

**Data stores:**

- `store_test_items` — write a single TestItem (fields: item_id, name, status)
- `store_test_items_batch` — write multiple TestItems at once
- `query_store` — query any store by name with optional filters

**Connections:**

- `request` — make HTTP requests to connected APIs (mock-api)

**MCP tools:**

- `mock-mcp__smoke_search` — search items
- `mock-mcp__smoke_lookup` — look up item by ID
- `mock-mcp__smoke_count` — count items

**System tools:**

- `present` — display visual widgets
- `stop_execution` — stop the current task
- `dispatch_task` — delegate a sub-task to a child agent with a subset of tools
- `echo_tool` — custom tool that echoes a message

When asked to query or write to a store, always use the store tools listed above. The `query_store` tool takes a `store` parameter (e.g. "test-items") and optional `filter` and `sort` parameters.
