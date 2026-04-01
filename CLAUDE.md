# Amodal

## Working in this repo

- Always work in a **git worktree** — never commit directly to main. Create with: `git worktree add ../amodal-work -b <branch-name>`
- The main repo at `~/code/amodal` may have other agents working in it. Use worktrees to avoid conflicts.
- Related repos: `~/code/packages` (marketplace packages, including `agent-admin`), `~/code/content-marketing` (test agent)

## Building

```bash
pnpm install
pnpm run build                              # builds core, runtime, test-utils, cli (excludes docs and runtime-app)
pnpm --filter @amodalai/runtime-app run build  # build the SPA separately (vite)
```

The root `build` script excludes `@amodalai/docs` and `@amodalai/runtime-app`. Build them separately when needed.

### Running from source

Point the `amodal` CLI at the local build:

```bash
# Replace the launcher script
rm ~/.amodal/bin/amodal
printf '#!/bin/bash\nexec node /path/to/amodal-work/packages/cli/dist/src/main.js "$@"\n' > ~/.amodal/bin/amodal
chmod +x ~/.amodal/bin/amodal
```

Restore the original with `cp ~/.amodal/bin/amodal.bak ~/.amodal/bin/amodal`.

The CLI finds the runtime-app SPA via `require.resolve('@amodalai/runtime-app/package.json')` — make sure the runtime-app `exports` field includes `"./package.json": "./package.json"`.

## Packages

| Package                 | Published | Description                              |
| ----------------------- | --------- | ---------------------------------------- |
| `@amodalai/core`        | Yes       | Agent SDK — ReAct loop, tools, providers |
| `@amodalai/runtime`     | Yes       | HTTP server — SSE, sessions, stores      |
| `@amodalai/amodal`      | Yes       | CLI                                      |
| `@amodalai/react`       | Yes       | React hooks, components, chat widget     |
| `@amodalai/runtime-app` | No        | Vite SPA for the dev UI                  |
| `@amodalai/docs`        | No        | Vocs documentation site                  |
| `@amodalai/test-utils`  | No        | Shared test utilities                    |

## Admin agent

- Package source: `~/code/packages/agent-admin`
- Global cache: `~/.amodal/admin-agent/`
- Local override: set `"adminAgent": "/path/to/agent-admin"` in `amodal.json`
- After editing the admin agent package, sync to cache: `rm -rf ~/.amodal/admin-agent && cp -R ~/code/packages/agent-admin ~/.amodal/admin-agent`
- Admin agent has `read_repo_file`, `write_repo_file`, `delete_repo_file` tools — scoped to agent config directories only

## PR template

```markdown
## What

<!-- Brief description of the change -->

## Why

<!-- Motivation — what problem does this solve? -->

## Test plan

<!-- How did you verify this works? -->

## Changeset

<!-- If this changes published packages, run `pnpm changeset` and include the generated file -->
```

## Changesets

- Create manually: write a `.changeset/<name>.md` file with YAML frontmatter listing packages and bump level
- Published packages: `core`, `runtime`, `react`, `cli`
- The changeset CLI (`pnpm changeset`) is interactive and doesn't work in non-TTY contexts — create the file directly instead

## Testing

```bash
pnpm test                                    # all tests
pnpm --filter @amodalai/runtime test         # runtime only
pnpm --filter @amodalai/runtime test -- --run <pattern>  # specific test file
```

## Docs

- Docs site: `packages/docs` (Vocs)
- Build: `pnpm --filter @amodalai/docs run build`
- Docs are excluded from the main CI build. There is a separate `docs` CI job.
- Docs use `.mdx` files in `packages/docs/pages/`

## Key architecture notes

- `agent-runner.ts` in runtime has its own `buildTools()` and `executeTool()` — it does NOT use the upstream gemini-cli-core tool registry for execution
- The upstream `@google/gemini-cli-core` has built-in file tools (write_file, edit, etc.) but they are not wired in — we use our own scoped tools instead
- Admin sessions are created via `sessionManager.createAdminSession()` which swaps in admin skills/knowledge while keeping the user's connections
