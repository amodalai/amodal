---
"@amodalai/runtime": patch
---

Run read-only tool calls concurrently within a turn.

The EXECUTING state handler now batches contiguous leading read-only,
non-confirmation, non-connection tool calls from the queue and runs them
via `Promise.all`. Writes, confirmation-gated tools, connection-ACL tools,
and `dispatch_task` still flow through the single-call path for
correctness.

**What changes:** when a model emits multiple parallel tool calls per
turn, independent reads (store reads, knowledge lookups, search/fetch,
etc.) return in one `max(tool_duration)` instead of `sum(tool_duration)`.
This also collapses N EXECUTING transitions into one, cutting
state-machine overhead.

**What stays the same:** sanitize/log behavior, SSE event shape (per-call
ToolCallStart + ToolCallResult events still fire for every call in batch
order), result-message ordering in the conversation history, pre-execution
cache (still honored per-call inside the batch), smart-snipping on
oversized results, and compaction threshold checks after the queue drains.

**Why it's safe:** tools declared `readOnly: true` have no external
side-effects that depend on ordering, so running them in parallel can't
change outcomes. Connection tools and tools flagged `requiresConfirmation`
are explicitly excluded because their gates must evaluate per-call.
