---
"@amodalai/runtime": patch
---

Add tool context factory (Phase 3.5a)

Creates `createToolContextFactory()` in `packages/runtime/src/session/tool-context-factory.ts` — the bridge between the Phase 3 agent loop and Phase 2 tool implementations. Wires `ctx.request()` to connection HTTP calls with auth headers, `ctx.store()` to store backend with key resolution, `ctx.env()` with allowlist, and `ctx.log()` to structured logger. Replaces the legacy `buildToolContext()` that depended on `AgentSession`.
