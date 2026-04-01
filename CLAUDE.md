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

## Admin agent

- Package source: `agent-admin` directory in the [amodalai/packages](https://github.com/amodalai/packages) repo
- Global cache: `~/.amodal/admin-agent/`
- Local override: set `"adminAgent": "/path/to/local/agent-admin"` in your agent's `amodal.json`
- After editing the package locally, sync to cache: `rm -rf ~/.amodal/admin-agent && cp -R /path/to/agent-admin ~/.amodal/admin-agent`
- Has `read_repo_file`, `write_repo_file`, `delete_repo_file` tools scoped to agent config directories

## Key architecture notes

- All LLM calls go through the upstream `@google/gemini-cli-core` GeminiClient, even for non-Google providers (Anthropic, OpenAI, etc.) — our `MultiProviderContentGenerator` adapts them
- Tools are registered on the upstream `ToolRegistry` — amodal tools (`request`, `load_knowledge`, `present`, stores), custom tools (from `tools/`), and MCP tools are all registered there
- Admin file tools (`read_repo_file`, `write_repo_file`, `delete_repo_file`) are in `packages/runtime/src/session/admin-file-tools.ts` with path validation
- Admin sessions swap repo skills/knowledge with admin content while keeping user connections (`sessionManager.createAdminSession()`)
- The system prompt is built by `buildDefaultPrompt()` in `packages/core/src/runtime/default-prompt.ts` — includes skills, knowledge bodies, connection API surface docs, field guidance, scope labels
- MCP connections are shared across sessions via `sharedMcpManager` on the SessionManager — not reconnected per session
- Eval judge uses direct LLM calls (`createRuntimeProvider`) instead of the full session/agent loop
