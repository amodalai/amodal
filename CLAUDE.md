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

## Key architecture notes

- All LLM calls go through the upstream `@google/gemini-cli-core` GeminiClient, even for non-Google providers (Anthropic, OpenAI, etc.) — our `MultiProviderContentGenerator` adapts them
- Tools are registered on the upstream `ToolRegistry` — amodal tools (`request`, `load_knowledge`, `present`, stores), custom tools (from `tools/`), and MCP tools are all registered there
- Admin file tools (`read_repo_file`, `write_repo_file`, `delete_repo_file`) are in `packages/runtime/src/session/admin-file-tools.ts` with path validation
- Admin sessions swap repo skills/knowledge with admin content while keeping user connections (`sessionManager.createAdminSession()`)
- The system prompt is built by `buildDefaultPrompt()` in `packages/core/src/runtime/default-prompt.ts` — includes skills, knowledge bodies, connection API surface docs, field guidance, scope labels
- MCP connections are shared across sessions via `sharedMcpManager` on the SessionManager — not reconnected per session
- Eval judge uses direct LLM calls (`createRuntimeProvider`) instead of the full session/agent loop
