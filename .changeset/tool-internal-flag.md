---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
---

Add `internal` flag for plumbing tool calls.

Tools can now declare `"internal": true` in `tool.json` to mark themselves as background plumbing the user shouldn't see by default (state I/O, version checks, internal coordination). The runtime stamps the flag onto `tool_call_start` SSE events; the React widget hides these calls from the chat unless the embedder enables `verboseTools` on the chat theme.

This keeps the chat surface honest — users see the meaningful steps (`Connected HubSpot`, `Added Slack`, `Tested the connection`) while bookkeeping calls (`read_setup_state`, `update_setup_state`) stay out of the way. Toggling `verboseTools` brings the full machinery back for debugging or demo use.

- `@amodalai/types` — `LoadedTool.internal`, `SSEToolCallStartEvent.internal`.
- `@amodalai/core` — `ToolJsonSchema.internal: z.boolean().optional()`.
- `@amodalai/runtime` — `ToolDefinition.internal`, propagation through `custom-tool-adapter` and `buildToolCallStartEvent`.
- `@amodalai/react` — `ToolCallInfo.internal`, reducer pass-through, `MessageList` filter on `verboseTools || !tc.internal`.

Anything that does _work_ (installs, OAuth, external API calls, file modifications) should leave the flag unset so users can see it. Tool authors only mark internal when the call is purely about coordination and the user-visible signal is conveyed elsewhere.
