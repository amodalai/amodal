# Amodal

## Working in this repo

- Always work in a **git worktree** — never commit directly to main. Create with: `git worktree add ../amodal-<name> -b <branch-name>`
- The main repo at `~/code/amodal` may have other agents working in it. Use worktrees to avoid conflicts.
- Related repos: `~/code/packages` (marketplace packages, including `agent-admin`), `~/code/content-marketing` (test agent)

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

- Package source: `~/code/packages/agent-admin`
- Global cache: `~/.amodal/admin-agent/`
- Local override: set `"adminAgent": "/path/to/agent-admin"` in the test agent's `amodal.json`
- After editing the package, sync to cache: `rm -rf ~/.amodal/admin-agent && cp -R ~/code/packages/agent-admin ~/.amodal/admin-agent`
- Has `read_repo_file`, `write_repo_file`, `delete_repo_file` tools scoped to agent config directories

## Key architecture notes

- `packages/runtime/src/agent/agent-runner.ts` has its own `buildTools()` and `executeTool()` — does NOT use the upstream gemini-cli-core tool registry for execution
- The upstream `@google/gemini-cli-core` has built-in file tools (write_file, edit, etc.) but they are not wired in — we use our own scoped file tools instead
- Admin sessions swap in admin skills/knowledge while keeping the user's connections (`sessionManager.createAdminSession()`)
