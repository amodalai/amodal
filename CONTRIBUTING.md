# Contributing to Amodal

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- [pnpm](https://pnpm.io/) 10.30.2

## Getting Started

```bash
# Clone the repo
git clone https://github.com/amodalai/amodal.git
cd amodal

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Development

```bash
# Run all tests
pnpm test

# Run tests in CI mode
pnpm test:ci

# Lint
pnpm lint

# Type check
pnpm typecheck
```

## Project Structure

This is a monorepo managed with pnpm workspaces:

| Package | Description |
| --- | --- |
| `packages/core` | Agent runtime core — config, tools, providers, security |
| `packages/runtime` | HTTP server for repo and platform modes |
| `packages/cli` | Command-line interface |
| `packages/react` | React bindings, hooks, and embeddable chat widget |
| `packages/runtime-app` | Runtime admin UI (private) |
| `packages/docs` | Documentation site (private) |
| `packages/test-utils` | Shared test utilities (private) |

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure all checks pass: `pnpm lint && pnpm typecheck && pnpm test`
4. Add a changeset if your change affects published packages (see below)
5. Submit a pull request

## Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs. All published packages share a single version number.

### When to add a changeset

Add one if your PR changes any published package (`core`, `runtime`, `react`, `cli`). Skip it for changes that only touch docs, CI, tests, or internal tooling.

### How to add a changeset

```bash
pnpm changeset
```

This prompts you to pick which packages changed and the bump level:

- **patch** — bug fixes, typos, internal changes
- **minor** — new features, non-breaking additions
- **major** — breaking changes (rare pre-1.0)

Write a short summary of the change. This creates a file in `.changeset/` that gets committed with your PR.

### What happens after your PR merges

A bot keeps a running "chore: version packages" PR updated with all pending changesets. When a maintainer merges that PR, all packages are published together at the new version and a GitHub Release is created.

### If you forget

The changesets bot will comment on your PR if it's missing a changeset. If the change doesn't need one, that's fine — just note it in the PR.

### If a maintainer disagrees with the bump level

They'll leave a comment asking you to update the changeset file (it's just markdown). If you've enabled "Allow edits from maintainers" on your PR (the default), they may update it directly.

## License Headers

All source files must include the following license header:

```
/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
```

This is enforced by ESLint and will fail CI if missing.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
