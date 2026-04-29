---
"@amodalai/types": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
"@amodalai/studio": patch
---

Admin agent tools for the conversational setup flow (Onboarding v4 — Phase 4).

**Five new admin-only tools** (gated by `sessionType === 'admin'`):

- `show_preview` — emits an inline `show_preview` SSE event with a curated agent-card snippet. The admin agent leads with this when recommending a template.
- `ask_choice` — emits a button-row question; the user's click posts the chosen value as the next user turn (no server round-trip).
- `search_packages` — wraps `npm` registry search (`/-/v1/search`) for keyword-based discovery.
- `install_package` — adds the package to `amodal.json#packages` and runs `npm install` in the agent repo.
- `write_skill` — scaffolds a `skills/<name>/SKILL.md` with frontmatter, trigger, and methodology.

**SSE event additions:**

- `@amodalai/types` — `SSEEventType.AskChoice`, `SSEEventType.ShowPreview` plus matching event interfaces.
- `@amodalai/runtime` — runtime mirrors the new event types and routes them through `ai-stream.ts`.
- `@amodalai/react` — widget renders `show_preview` events as inline `<AgentCardInlinePreview>` cards and `ask_choice` events as `<AskChoiceCard>` button rows. New `submitAskChoiceResponse` callback on `useChat` posts the chosen value as the next user turn.

**Tool-context plumbing:**

- New `ctx.emit(event)` method on `ToolContext` lets tools push inline SSE events. Per-call `inlineEvents` sink is drained by the executing state and emitted before the `tool_call_result` event so the chat UI can render the card / buttons above the result block.
