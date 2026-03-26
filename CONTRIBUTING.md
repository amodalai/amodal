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
| `packages/react` | React bindings and hooks |
| `packages/chat-widget` | Embeddable chat widget |
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

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

If your change affects any published package (`core`, `runtime`, `cli`, `react`, `chat-widget`), add a changeset:

```bash
pnpm changeset
```

This will prompt you to select which packages are affected and whether the change is a patch, minor, or major update. Write a short summary of the change.

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
