---
"@amodalai/types": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
---

OAuth polish — inline Connect buttons in chat (Onboarding v4 — Phase 6).

**`start_oauth_connection` admin tool.** Renders an inline Connect button in the chat for an installed connection package; click → `GET /api/oauth/start?package=<name>` (the existing OSS broker on localhost, or the new platform-api shim on cloud) → opens the provider's authorize URL in a popup. The user finishes auth without leaving chat.

- New `SSEEventType.StartOAuth` / `SSEStartOAuthEvent` in `@amodalai/types` and the runtime mirror, plus an `ai-stream.ts` mapping.
- Routed through `ToolInlineEvent` so the existing `ctx.emit` plumbing in the executing state surfaces it before each `tool_call_result`.
- `@amodalai/react` mirrors the type, adds a `StartOAuthBlock` content block + reducer case, and renders the new `<StartOAuthCard>` widget. Existing CSS variables match the rest of the chat surface.
- Admin agent prompt updated to mention `start_oauth_connection` and explicitly say "never tell the user to visit `/getting-started`."
