# Amodal

[![CI](https://github.com/amodalai/amodal/actions/workflows/ci.yml/badge.svg)](https://github.com/amodalai/amodal/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@amodalai/core)](https://www.npmjs.com/package/@amodalai/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Open-source agent runtime platform. Define AI agents with markdown and JSON — no application code required.

[Docs](https://docs.amodalai.com) | [Getting Started](#getting-started) | [Architecture](#architecture) | [Contributing](./CONTRIBUTING.md) | [Discord](https://discord.gg/amodalai)

## What is Amodal?

Amodal lets you build production-grade AI agents by describing them in a git repo of configuration files. Define skills, tools, knowledge bases, and connections in markdown and JSON — Amodal handles the runtime, streaming, session management, and tool execution.

```
my-agent/
├── amodal.json          # Agent config — models, providers, settings
├── skills/              # What the agent can do (markdown)
├── knowledge/           # What the agent knows (markdown)
├── connections/         # External service connections — REST APIs and MCP servers
├── stores/              # Persistent state schemas (JSON)
├── pages/               # Custom UI surfaces beyond chat
├── automations/         # Event-triggered tasks
└── evals/               # Test cases for agent behavior
```

## Getting Started

### Install

```bash
npm install -g @amodalai/amodal
```

### Create an agent

```bash
amodal init my-agent
cd my-agent
amodal dev
```

This scaffolds a new agent project and starts a local dev server with hot reload and an interactive chat UI.

### From source

```bash
git clone https://github.com/amodalai/amodal.git
cd amodal
pnpm install
pnpm build
```

**Requirements:** Node.js >= 20, pnpm 10.30.2

## Highlights

- **Config-driven agents** — describe behavior in markdown and JSON, not application code
- **Multi-provider** — Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure OpenAI, or any OpenAI-compatible endpoint
- **Skills & knowledge** — pre-built plugins for incident response, deal triage, compliance, lead scoring, and more
- **Stores** — persistent key-value state (PGlite or PostgreSQL) that agents read and write across conversations
- **Pages** — custom UI surfaces beyond chat, defined in config and rendered by the runtime
- **Tool system** — HTTP tools, chain tools, function tools, and MCP server support
- **Secure by default** — audit logging, role-based access, credential scrubbing, sandbox execution
- **Embeddable** — React components and a drop-in chat widget for any web app
- **Evals** — test agent behavior with structured evaluation cases

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   CLI / UI  │────▶│   Runtime   │────▶│     Core     │
│             │     │  (HTTP/SSE) │     │  (Agent SDK) │
└─────────────┘     └─────────────┘     └──────────────┘
                          │                     │
                    ┌─────┴─────┐         ┌─────┴─────┐
                    │  Sessions │         │ Providers  │
                    │  Stores   │         │ Tools      │
                    │  Cron     │         │ Skills     │
                    │  Webhooks │         │ Knowledge  │
                    └───────────┘         │ Security   │
                                          └───────────┘
```

**Core** handles the agent loop — config resolution, tool registration, LLM provider dispatch, knowledge retrieval, and security guardrails.

**Runtime** is the HTTP server — SSE streaming, session management, persistent stores, cron scheduling, and webhook handling.

**CLI** is the developer interface — scaffold projects, run local dev servers, deploy, manage connections, and run evals.

## Packages

These four packages are published to npm and versioned together:

| Package                                   | What it does                                                | Who uses it                                 |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| [`@amodalai/core`](./packages/core)       | Agent SDK — ReAct loop, tools, skills, knowledge, providers | Anyone building on or extending the runtime |
| [`@amodalai/runtime`](./packages/runtime) | HTTP server — SSE streaming, session management, stores     | Anyone self-hosting the agent server        |
| [`@amodalai/amodal`](./packages/cli)      | CLI — chat, deploy, init, connect, eval                     | Every developer using the platform          |
| [`@amodalai/react`](./packages/react)     | React hooks, components, chat widget, and embeddable UI     | ISVs embedding the agent in their product   |

Internal packages (not published to npm): `runtime-app` (Vite dev UI), `docs`, `test-utils`.

## CLI Commands

### Top-level

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `amodal init`       | Scaffold a new agent project            |
| `amodal dev`        | Start local dev server with hot reload  |
| `amodal chat`       | Interactive chat session                |
| `amodal validate`   | Validate agent configuration            |
| `amodal inspect`    | Inspect agent config, tools, and skills |
| `amodal eval`       | Run evaluation suites                   |
| `amodal test-query` | Fire a one-off query against the agent  |

### `amodal pkg` — Package management

| Command                | Description                         |
| ---------------------- | ----------------------------------- |
| `amodal pkg connect`   | Add a connection (plugin or custom) |
| `amodal pkg install`   | Install a package from the registry |
| `amodal pkg uninstall` | Remove a package                    |
| `amodal pkg update`    | Update packages or the admin agent  |
| `amodal pkg list`      | List installed packages             |
| `amodal pkg search`    | Search the marketplace              |
| `amodal pkg diff`      | Show package changes                |
| `amodal pkg publish`   | Publish a package to the registry   |
| `amodal pkg link`      | Link project to platform app        |
| `amodal pkg sync`      | Sync API specs from remote sources  |

### `amodal deploy` — Deployment lifecycle

| Command                  | Description                        |
| ------------------------ | ---------------------------------- |
| `amodal deploy push`     | Deploy to the Amodal platform      |
| `amodal deploy build`    | Build agent snapshot               |
| `amodal deploy serve`    | Start the runtime server           |
| `amodal deploy status`   | Show deployment status             |
| `amodal deploy list`     | List deployment history            |
| `amodal deploy rollback` | Roll back to a previous deployment |
| `amodal deploy promote`  | Promote a deployment to production |

### `amodal ops` — Platform operations

| Command                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `amodal ops secrets`     | Manage platform secrets                      |
| `amodal ops docker`      | Generate Docker deployment files             |
| `amodal ops automations` | List, pause, resume, and trigger automations |
| `amodal ops audit`       | Review agent audit logs                      |
| `amodal ops experiment`  | Compare models, prompts, or configs          |

### `amodal auth` — Authentication

| Command              | Description                    |
| -------------------- | ------------------------------ |
| `amodal auth login`  | Authenticate with the platform |
| `amodal auth logout` | Log out of the platform        |

## Providers

Amodal supports multiple LLM providers. Configure in `amodal.json`:

```json
{
  "name": "my-agent",
  "models": {
    "main": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
    "simple": { "provider": "openai", "model": "gpt-4o-mini" },
    "advanced": { "provider": "anthropic", "model": "claude-opus-4-20250514" }
  }
}
```

Supported: **Anthropic** (default), **OpenAI**, **Google Gemini**, **AWS Bedrock**, **Azure OpenAI**, and any **OpenAI-compatible** endpoint.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, project structure, and how to submit changes.

## Security

See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

## License

[MIT](./LICENSE)
