---
"@amodalai/runtime": patch
---

Unify `executeTool` and `executeToolWithEvents` into a single function.

The two functions differed only in whether they captured inline SSE events emitted via `ctx.emit()`. The wrapper version (`executeTool`) was unused outside its own definition, but provided a type shape that mismatched the `preExecutionCache`. During recent merges from main this caused a footgun where one branch called `executeTool` while the other imported `executeToolWithEvents`, types compiled, runtime broke.

`executeTool` now always returns `{output, inlineEvents}`. Callers that don't care about events destructure `{output}`; the inline events array is empty when the tool didn't emit. One shape, one function — no caller has to choose.

This also simplifies the foundation for intent executors (regex-driven shortcuts that bypass the LLM) which need to capture inline events tools emit when running them directly.
