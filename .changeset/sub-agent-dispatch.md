---
"@amodalai/runtime": patch
---

Implement sub-agent dispatch (Phase 3.6)

- New `dispatch_task` tool: Zod-validated schema for delegating sub-tasks to child agents with a subset of tools
- DISPATCHING state handler: runs child `runAgent()` loop, wraps child events as `SSESubagentEvent` effects, merges child usage into parent
- EXECUTING state handler intercepts `dispatch_task` by name and transitions to DISPATCHING (avoids circular dependency)
- Child tools automatically exclude `dispatch_task` to prevent infinite recursion
- Child maxTurns defaults to 10 (budget-capped)
- Registered as system tool in session-builder alongside present and stop_execution
