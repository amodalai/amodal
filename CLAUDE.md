# Amodal

## Working in this repo

- Always work in a **git worktree** — never commit directly to main. Create with: `git worktree add ../amodal-<name> -b <branch-name>`
- The main repo may have other agents working in it. Use worktrees to avoid conflicts.
- Related repo: [amodalai/packages](https://github.com/amodalai/packages) (marketplace packages, including `agent-admin`)

## Building

The root `pnpm build` excludes `@amodalai/docs` and `@amodalai/runtime-app`. Build them separately:

```bash
pnpm run build                                     # core, runtime, test-utils, cli
pnpm --filter @amodalai/runtime-app run build      # SPA (vite)
pnpm --filter @amodalai/docs run build             # docs site (vocs)
```

After changing runtime, runtime-app, or CLI code, rebuild before testing with `amodal dev`.

See README "Developing from Source" section for linking the CLI to a local build.

## PRs and changesets

- PR template is at `.github/pull_request_template.md` — follow it. Use raw markdown (no rendered preview).
- Changesets: create `.changeset/<name>.md` files directly (the `pnpm changeset` CLI is interactive and won't work here). Published packages: `core`, `runtime`, `react`, `cli`.
- **Always use `patch` bumps** unless the user explicitly says otherwise. Even for new features or breaking-looking changes — patch by default.

### Adding a new workspace package

If a new `packages/*` package will be imported (directly or transitively) by any published package — currently `@amodalai/types`, `@amodalai/core`, `@amodalai/runtime`, `@amodalai/react`, `@amodalai/amodal`, `@amodalai/runtime-app`, `@amodalai/snapshot-probe` — then **the new package itself must be publishable**. Otherwise `pnpm publish` rewrites the `workspace:*` ref to a version that doesn't exist on npm, and installs fail with `ERR_PNPM_FETCH_404` on the private dep.

A publishable package needs:

- `private: false` (or the field omitted)
- `license`, `repository`, `homepage`, `bugs`, and `files: ["dist"]` in `package.json`
- A version that matches the `fixed` group in `.changeset/config.json`
- An entry added to the `fixed` array in `.changeset/config.json` so it versions in lockstep with the rest of the public packages

CI enforces this invariant via `scripts/check-publishable-deps.js` (run as part of `pnpm lint`): if any public workspace package depends on a private workspace package, the lint job fails with the list of violations. If you genuinely need an internal-only package (tests, tooling, build utilities), make sure no published package imports from it.

## Admin agent

- Package source: `agent-admin` directory in the [amodalai/packages](https://github.com/amodalai/packages) repo
- Global cache: `~/.amodal/admin-agent/`
- Local override: set `"adminAgent": "/path/to/local/agent-admin"` in your agent's `amodal.json`
- After editing the package locally, sync to cache: `rm -rf ~/.amodal/admin-agent && cp -R /path/to/agent-admin ~/.amodal/admin-agent`
- Has `read_repo_file`, `write_repo_file`, `delete_repo_file` tools scoped to agent config directories

## Styling (runtime-app)

The runtime-app uses Tailwind CSS with semantic design tokens defined as CSS custom properties in `packages/runtime-app/src/index.css`. **Never use raw color classes for brand or structural colors.** Use the tokens:

| Token                   | Use for                                                       | Instead of                                |
| ----------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `text-foreground`       | Primary text                                                  | `text-gray-900 dark:text-zinc-200`        |
| `text-muted-foreground` | Secondary/subtle text                                         | `text-gray-500 dark:text-zinc-400`        |
| `bg-background`         | Page background                                               | `bg-white dark:bg-[#0a0a0f]`              |
| `bg-card`               | Elevated surfaces (headers, sidebars)                         | `bg-gray-50 dark:bg-[#0f0f17]`            |
| `bg-muted`              | Subtle backgrounds (hover, selected)                          | `bg-gray-100 dark:bg-zinc-800/40`         |
| `border-border`         | All borders                                                   | `border-gray-200 dark:border-zinc-800/50` |
| `text-primary`          | Brand accent text, links                                      | `text-blue-600 dark:text-blue-400`        |
| `bg-primary/10`         | Subtle accent background                                      | `bg-blue-500/10`                          |
| `bg-primary-solid`      | Solid accent surfaces with white text (buttons, chat bubbles) | `bg-blue-700`                             |

**Rules:**

- No `dark:` prefix needed for structural colors — the tokens handle it
- Use `bg-primary-solid` (not `bg-primary`) when white text sits on top — it stays dark in both modes
- Semantic colors are raw Tailwind and that's OK: `emerald` (success), `red` (error), `amber` (warning), `violet` (packages/MCP)
- Data palette colors in `EnumBadge.tsx` use raw colors for differentiation — that's intentional
- HTTP method colors (`text-blue-500` for GET, `text-emerald-500` for POST) are semantic, not brand

To change the brand color app-wide, edit `--primary`, `--primary-solid`, and `--ring` in `index.css`.

## Engineering Standards

These rules apply to ALL code in this repo. They are non-negotiable.

### No Magic Strings

- **CSS**: All colors, spacing, shadows reference design tokens (`--primary`, `--muted-foreground`, etc.), never hex/rgb/hsl literals. See the Styling section above.
- **Events**: Use `SSEEventType` enum or the `SSEEvent` discriminated union, never raw strings for event types.
- **Config**: Use typed config objects. Never read `process.env` directly in business logic — go through the config module.
- **Store/tool names**: Use constants or derive from schemas, not scattered string literals.
- **Route paths**: Define as constants, not inline strings.

### Logging

- Use the `Logger` interface, never `console.log`, `console.error`, or `process.stderr.write`.
- Every tool call, state transition, and error must emit a structured log event.
- Log format: `logger.info('event_name', { key: value })` — snake_case event names, data object.
- **Always log**: tool name + status + duration on every tool call. Session ID + tenant ID on every operation. Error context (what operation, what inputs, what state) on every error.
- **Never log**: raw API keys, credentials, tokens, or full PII. Use redacted patterns (`user_***@***.com`).

### Error Handling

- **Never swallow errors silently.** No empty catch blocks. No `catch (e) { return null }`. No `catch (e) { log(e) }` without re-throw. These hide failures and cause cascading bugs that are impossible to diagnose.
- Functions that can fail return `Result<T, E>` — the caller is forced to handle both cases. Never return `null` to indicate failure (caller can't distinguish "not found" from "broken").
- **Four valid reasons to catch:**
  1. Enrich and re-throw (add context: `throw new StoreWriteError(store, id, err)`)
  2. Module boundary → structured error response (API routes, tool executors)
  3. Specific expected failure with specific handling (retry, fallback — then re-throw everything else)
  4. Cleanup — use `finally`, not `catch`
- Use typed error classes (`ProviderError`, `ToolExecutionError`, `StoreError`, etc.), not bare `new Error('...')`.
- Errors carry context: what operation failed, what the inputs were, what state the system was in.
- Error boundaries live at **module edges** (API route, tool executor, session manager), NOT inside store backends, NOT inside utility functions.

### Async Discipline

- **No floating promises.** Every async call is `await`ed or explicitly `void`ed with `.catch()`. Enable ESLint `@typescript-eslint/no-floating-promises`.
- **Handle sibling promises from shared-source async results.** When a function returns an object with multiple promises backed by one underlying operation (e.g. `StreamTextResult` with `fullStream` + `text` + `usage` all tied to a single fetch, or deferred promise pairs that resolve/reject together), iterating or awaiting one before the siblings means a mid-iteration throw leaves the siblings unhandled. Attach passive `.catch(() => {})` to every sibling promise BEFORE entering the for-await. ESLint's `no-floating-promises` does NOT catch this — it sees the eventual `await siblings` line and assumes all paths reach it.
- **Timeouts on all external operations.** Every provider call, MCP call, tool execution, and store operation gets `AbortSignal.timeout()`. No hanging forever on a broken external system.
- **Exhaustive switch on discriminated unions.** Use the `never` trick in `default:` so adding a new variant causes a compile error, not a silent fallthrough.

### Types

- **No `any`** — use `unknown` and narrow with type guards.
- **No `as` casts** except at system boundaries (parsing external JSON/API responses where you validate first).
- Use discriminated unions for state types (`AgentState`, `SSEEvent`, `ToolResult`).
- Interface segregation: don't make consumers depend on interfaces they don't use.

### Module Boundaries

- No importing from another module's internal files (e.g., don't import `../agent/internal/helper.ts` from the session manager).
- No accessing private fields via `(obj as any).field` or `obj['_privateField']`.
- No circular dependencies between modules.
- Each module wraps errors at its boundary with module-specific error types.

### Tool Schemas

- **Code-defined tools** (store, connection, admin): use Zod schemas for TypeScript type inference on the execute function.
- **External-schema tools** (MCP tools, custom tools from `tool.json`): use `jsonSchema()` from the AI SDK. Pass the schema through unchanged — never convert to Zod and back (lossy round-trip that can lose `nullable`, `oneOf`, `$ref`, `format` constraints).

### Testing

- Integration tests over unit tests for tool execution — test the real path, not mocks.
- Contract tests for SSE events — if an event shape changes, the test fails before the UI breaks.
- Don't test implementation details — test public behavior. Private functions can be refactored freely.
- **Every subprocess must have a smoke test.** If `amodal dev` spawns a subprocess (Studio, admin agent), there must be a smoke test that verifies the subprocess starts and responds to health checks. Silent failures that skip broken subprocesses are not acceptable.

## Key architecture notes

- All LLM calls go through the Vercel AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) via `packages/runtime/src/providers/create-provider.ts`
- The eval judge uses `generateText()` from the AI SDK directly (no custom provider abstraction)
- `amodal dev` spawns three processes: runtime (port 3847), Studio (port 3848), admin agent (port 3849). Each is a separate Express server. Studio proxies admin chat to the admin agent over HTTP.
- The admin agent is an npm package (`@amodalai/agent-admin`) fetched and cached at `~/.amodal/admin-agent/` on first run
- The system prompt is built by `buildDefaultPrompt()` in `packages/core/src/runtime/default-prompt.ts` — includes skills, knowledge bodies, connection API surface docs, field guidance, scope labels
- MCP connections are shared across sessions via `sharedMcpManager` on the SessionManager — not reconnected per session
