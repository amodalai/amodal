---
"@amodalai/react": patch
"@amodalai/runtime": patch
---

Unify chat-stream plumbing behind a single canonical `useChatStream`
hook. Both `useChat` and `useAmodalChat` now delegate to it, and the
admin chat in the runtime app gets tool-call callouts for free — it
previously rolled its own SSE parser that silently dropped every
event type except `init`, `text_delta`, and `error`.

`useChatStream` owns the reducer, the SSE → action mapping, and the
widget event bus. Consumers inject transport via a `streamFn` option:

```ts
const stream = useChatStream({
  streamFn: (text, signal) =>
    streamSSE("/my/endpoint", { message: text }, { signal }),
  onToolCall: (call) => console.log("tool finished:", call),
});
```

The public API of `useChat` and `useAmodalChat` is unchanged — the
refactor is internal. No behavior changes for existing consumers
beyond a few previously-missing fixes that are now in the canonical
reducer (e.g. `parameters` fallback on `tool_call_result`, usage
accumulation on `done`).

New exports from `@amodalai/react`:

- `useChatStream`, `UseChatStreamOptions`, `UseChatStreamReturn`
- `chatReducer` (re-exported from the canonical location)
