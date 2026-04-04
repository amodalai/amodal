# Contributing to Amodal

Thanks for your interest in contributing. This guide covers the workflow, conventions, and standards we expect from every PR.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- [pnpm](https://pnpm.io/) 10.30.2

## Getting Started

```bash
git clone https://github.com/amodalai/amodal.git
cd amodal

pnpm install
pnpm build
```

The root `pnpm build` excludes `@amodalai/docs` (the docs site) and `@amodalai/runtime-app` (the SPA). Build those separately if you touch them:

```bash
pnpm --filter @amodalai/runtime-app run build
pnpm --filter @amodalai/docs run build
```

## Worktree Workflow

**Always work in a git worktree — never commit directly to `main`.** The main repo may have other contributors (and other Claude instances) working in parallel. Worktrees prevent conflicts.

```bash
git worktree add ../amodal-<short-name> -b <branch-name>
cd ../amodal-<short-name>
# ... do your work, commit, push ...
# When done:
git worktree remove ../amodal-<short-name>
```

## Development

```bash
pnpm test        # run all tests
pnpm test:ci     # tests in CI mode
pnpm lint        # ESLint
pnpm typecheck   # TypeScript across all packages
```

After changing runtime, runtime-app, or CLI code, rebuild before testing with `amodal dev`. See the README's "Developing from Source" section for linking the CLI to a local build.

## Project Structure

Monorepo managed with pnpm workspaces:

| Package                | Role                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/types`       | Zero-dep shared types. Safe to import from any context.                                                          |
| `packages/core`        | Build utilities — repo loading, NPM package management, KB formatting, MCP manager. No runtime code.             |
| `packages/runtime`     | Agent engine. State machine, providers, tools, stores, session manager, HTTP server. `createAgent()` public API. |
| `packages/cli`         | CLI binary (`amodal` command). Built with Ink.                                                                   |
| `packages/react`       | React components, hooks, and embeddable chat widget.                                                             |
| `packages/runtime-app` | Runtime admin UI (SPA, not published).                                                                           |
| `packages/docs`        | Documentation site (Vocs, not published).                                                                        |
| `packages/test-utils`  | Shared test utilities (not published).                                                                           |

Dependency direction: `types` ← `core`/`runtime` ← `cli`/`react`/`app`. No circular deps.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full subsystem layout.

## Engineering Standards

Every PR is reviewed against the standards in [CLAUDE.md](./CLAUDE.md). The high points:

- **No magic strings** — use design tokens, enums, or constants, not raw literals
- **Use the Logger interface** — never `console.log` / `process.stderr.write` in runtime code
- **Errors are values** — return `Result<T, E>` from store/tool paths; never `catch (e) { return null }`; typed error classes, not bare `new Error('...')`
- **Async discipline** — no floating promises (`await` or explicit `.catch()`), timeouts on all external calls, exhaustive switches with the `never` trick
- **No `any`** — use `unknown` + narrowing; no `as` casts except at system boundaries
- **Module boundaries** — no reaching into another module's internal files, no private-field access via bracket notation

When the refactor lands in 0.2.0, see `/guide/engineering-standards` in the docs for the long-form reference.

## Making Changes

1. Create a worktree with a descriptive branch name (`fix/session-store-mirror`, `feat/budget-enforcement`)
2. Make your changes
3. Ensure all checks pass: `pnpm lint && pnpm typecheck && pnpm test`
4. Add a changeset if your change affects published packages (see below)
5. Push the branch and open a PR using the template in `.github/pull_request_template.md`

## Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs. Published packages (`core`, `runtime`, `react`, `cli`, `types`) share a single version via the "fixed" group in `.changeset/config.json`.

### When to add a changeset

Add one if your PR changes any published package. Skip it for changes that only touch docs, CI, tests, or internal tooling.

### How to add a changeset

The `pnpm changeset` CLI is interactive. If you're running in a non-interactive environment (agent, script, remote session), create the file directly:

```bash
cat > .changeset/my-change.md <<'EOF'
---
'@amodalai/runtime': patch
---

Short summary of what changed and why.
EOF
```

Bump levels:

- **patch** — bug fixes, typos, internal changes
- **minor** — new features, non-breaking additions
- **major** — breaking changes (rare pre-1.0)

### What happens after your PR merges

A bot keeps a running "chore: version packages" PR updated with all pending changesets. When a maintainer merges that PR, all packages publish together at the new version with a GitHub Release.

## License Headers

All source files must include:

```typescript
/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
```

Enforced by ESLint. CI will fail if missing.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).
