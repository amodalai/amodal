---
"@amodalai/runtime": patch
---

Fix process crash when an SSE client disconnects mid-stream.

When a browser tab reloads, navigates away, or otherwise drops an in-flight
SSE connection, the route's `res.on('close', () => controller.abort())`
handler fires `ctx.signal.abort()`. Inside the agent loop, the provider's
`streamText()` returns a `StreamTextResult` with three separate promises
(`fullStream`, `text`, `usage`) that share the same upstream fetch. When
the fetch aborts, all three reject.

`handleStreaming` iterates `fullStream` first and only awaits `text`/`usage`
after the loop completes. If the loop throws due to abort, the derived
promises were never awaited and Node surfaces them as unhandled promise
rejections, crashing the process.

The fix attaches passive `.catch(() => {})` handlers to `state.stream.text`
and `state.stream.usage` at the top of `handleStreaming`, before entering
the for-await loop. The real error still surfaces via the thrown stream
error that propagates up to the route's try/catch; the suppressed handlers
only prevent an abort-induced rejection from escaping as unhandled.

This was most visible in the admin-chat route (browser auto-reloads on
`config_reloaded` events triggered by `write_repo_file` tool calls), but
affects every streaming chat route equally.
