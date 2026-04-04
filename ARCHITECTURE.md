# Architecture

High-level map of the Amodal codebase. Read this before making changes that cross package boundaries.

For the conceptual runtime architecture (state machine, SSE streaming, layered system), see the [public architecture docs](packages/docs/pages/reference/architecture.mdx). This file is contributor-facing: where things live and why.

## Package Dependency Graph

```
types (zero deps)
  ↑
  ├── core (build utilities, MCP, KB formatting)
  │     ↑
  │     └── cli
  │
  └── runtime (agent engine, HTTP server, tools, stores)
        ↑
        ├── runtime-app (SPA admin UI)
        └── react (components, chat widget)
```

**Rules:**

- `types` is zero-dep. If you're adding a type used by any other package, put it here.
- `core` and `runtime` are siblings, not parent/child. Both depend on `types`.
- `runtime` does NOT depend on `core` for runtime code — it only uses core's build utilities (e.g., `loadRepo`, `ensureAdminAgent`, `McpManager`).
- Nothing depends on `cli` / `docs` / `runtime-app` — they're leaves.

## `packages/runtime/src/` Subsystem Layout

```
agent/                        agent-specific (local server, proactive runner, state handlers)
  loop.ts                     runAgent() generator + transition() dispatcher
  loop-types.ts               AgentState, AgentContext, DoneReason
  states/                     one file per state (thinking, streaming, executing, confirming, compacting, dispatching)
  local-server.ts             Express server for `amodal dev`
  page-builder.ts             compiles user pages via esbuild
  proactive/                  automation scheduler + webhook runner
  routes/                     HTTP routes specific to agent mode (task, files, stores, evals, inspect, admin-chat, webhooks, automations)

api/                          public API
  create-agent.ts             createAgent() factory → Agent interface

providers/                    LLM provider layer
  types.ts                    LLMProvider interface, StreamTextResult, TokenUsage
  create-provider.ts          factory: Anthropic / OpenAI / Google (via Vercel AI SDK)
  failover.ts                 createFailoverProvider() — retry chain
  anthropic-cache.ts          prompt-cache injection for Anthropic messages

tools/                        tool system
  types.ts                    ToolDefinition, ToolRegistry, ToolContext
  registry.ts                 ToolRegistry impl — register/get/names/subset
  store-tools.ts              store_write_*, store_batch_*, query_store
  request-tool.ts             HTTP connection tool with PermissionChecker integration
  custom-tool-adapter.ts      wraps user handler.ts via ctx factory
  mcp-tool-adapter.ts         wraps MCP-discovered tools
  admin-file-tools.ts         read_repo_file / write_repo_file / delete_repo_file
  dispatch-tool.ts            dispatch_task — sub-agent spawn

session/                      session management
  manager.ts                  StandaloneSessionManager (runMessage, persist, get, destroy)
  types.ts                    Session, SessionMetadata, CreateSessionOptions
  session-builder.ts          buildSessionComponents — assembles provider + tools + permission checker
  store.ts                    PGLiteSessionStore (persistence)
  stream-hooks.ts             StreamHooks interface

routes/                       shared HTTP routes
  chat-stream.ts              POST /chat, /chat/stream (SSE)
  chat.ts                     POST /chat/sync (non-streaming)
  ai-stream.ts                POST /chat/ai-stream (Vercel AI UI protocol)
  webhooks.ts                 webhook router for automations
  session-resolver.ts         resolves sessionId → Session (create/resume/load)
  route-helpers.ts            asyncHandler, fireDrainHooks, adaptOnUsage
  session-store.ts            (under agent/) legacy file-based store for UI history

context/                      system prompt compilation
  compiler.ts                 ContextCompiler — merges skills/knowledge/connections/stores into a single prompt

security/                     ACL enforcement
  permission-checker.ts       PermissionChecker — reads access.json, returns PermissionResult
  field-scrubber.ts           strips hidden fields from tool outputs

stores/                       data store backends
  pglite-store-backend.ts     local PGLite via Drizzle
  drizzle-store-backend.ts    the Drizzle-based backend (Postgres + PGLite share this)
  postgres-store-backend.ts   Postgres via Drizzle (shares drizzle-store-backend)

middleware/                   Express middleware
  error-handler.ts            structured JSON error responses
  request-validation.ts       Zod-based body validation
  auth.ts                     auth context extraction

config.ts                     AgentConfig loader (amodal.json + env vars)
logger.ts                     structured logger (Logger interface, child() support, JSON mode)
errors.ts                     typed error classes + Result<T, E>
types.ts                      SSEEvent discriminated union, ChatRequest/Response, SSEEventType enum
index.ts                      package exports
server.ts                     createServer() — the Express bootstrap
constants.ts                  LOCAL_APP_ID, etc.
```

## Where to Put Things

**Adding a new provider** → `packages/runtime/src/providers/create-provider.ts`. Add a case for the provider name, wire the `@ai-sdk/<name>` package. If the provider needs special request shaping (like Anthropic's prompt caching), add a sibling file.

**Adding a new tool** → Decide the category:

- Store-like → extend `store-tools.ts`
- HTTP/connection-based → probably a custom tool in the user's repo, not a built-in
- System capability (dispatch, load_knowledge) → new file in `packages/runtime/src/tools/`, register in `session-builder.ts`

**Adding a new SSE event** → Add the variant to `types.ts` (both the enum and the discriminated union). Then:

- Add a case in `ai-stream.ts` to translate it to the UI stream (or explicitly drop it)
- Any consumer that handles `SSEEvent` needs to add a case (compiler will force this via the `never` exhaustiveness check)

**Adding a new agent state** →

1. Add variant to `AgentState` in `loop-types.ts`
2. Add handler in `packages/runtime/src/agent/states/<name>.ts`
3. Add case in `transition()` in `loop.ts`
4. Write tests in `loop.test.ts`

**Adding a new HTTP route** →

- If it's specific to the `amodal dev` local server, put it in `packages/runtime/src/agent/routes/`
- If it's a core chat/session route, put it in `packages/runtime/src/routes/`
- Wrap async handlers with `asyncHandler()` from `route-helpers.ts`

**Adding a new error class** → `packages/runtime/src/errors.ts`. Extend `AmodalError`. Include a structured `context` field.

## Error Boundaries

Module boundaries catch and wrap errors. Internals don't.

**Catches errors:** API route handlers, the tool executor, the session manager.

**Does NOT catch errors:** Store backends, utility functions, state handlers (they let errors propagate to the loop).

If you find yourself writing `catch (e) { return null }` or `catch (e) { log.error(e) }` without re-throwing, stop. See [CLAUDE.md](./CLAUDE.md) § Error Handling for the four valid reasons to catch.

## Testing Philosophy

- **Integration tests > unit tests** for tool execution — the real path, not mocks
- **Contract tests for SSE events** — if an event shape changes, the test fails before the UI breaks
- **Provider round-trip tests** — slow (real API calls), but catches serialization bugs mocks hide
- **Eval tests as regression tests** — expensive but irreplaceable for verifying agent behavior

Don't test implementation details — test public behavior. Private functions can be refactored freely.

## Before major refactors

Read [CLAUDE.md](./CLAUDE.md) §Engineering Standards end-to-end. The patterns there (no silent catches, no floating promises, timeouts on external ops, error boundaries at module edges, exhaustive switches) exist because we hit the opposite of each one in earlier versions of the codebase. Violate them and you'll re-introduce bugs we already paid for.
