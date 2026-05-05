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
mkdir my-agent && cd my-agent
amodal init
amodal dev
```

This scaffolds a new agent project in the current directory and starts a local dev server with hot reload and an interactive chat UI. Use `--provider` to pick your LLM (defaults to Anthropic).

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
- **Multi-provider** — Anthropic, OpenAI, Google Gemini, and OpenAI-compatible endpoints
- **Skills & knowledge** — pre-built plugins for incident response, deal triage, compliance, lead scoring, and more
- **Stores** — persistent key-value state (PGlite or PostgreSQL) that agents read and write across conversations
- **Pages** — custom UI surfaces beyond chat, defined in config and rendered by the runtime
- **Tool system** — HTTP tools, chain tools, function tools, and MCP server support
- **Web search & fetch** — optional `web_search` and `fetch_url` built-in tools backed by Gemini grounding, work with any main model (see below)
- **Secure by default** — audit logging, role-based access, credential scrubbing, sandbox execution
- **Embeddable** — React components and a drop-in chat widget for any web app
- **Memory** — agents remember facts across sessions; entries persist and are injected into the system prompt
- **Scope (per-user isolation)** — ISVs can isolate memory, stores, and sessions per end user via `scope_id`
- **Evals** — test agent behavior with structured evaluation cases

## Memory

Enable persistent memory so the agent can remember facts across sessions:

```json
{
  "memory": {
    "enabled": true
  }
}
```

When enabled, the agent gets a built-in `memory` tool with `add`, `remove`, `list`, and `search` actions. Memory entries are stored as individual rows in the database, scoped by agent (and optionally by user — see [Scope](#scope-per-user-isolation) below). On each new session, existing entries are injected into the system prompt automatically.

Optional config fields:

| Field           | Default | Description                                                   |
| --------------- | ------- | ------------------------------------------------------------- |
| `maxEntries`    | 50      | Maximum number of memory entries                              |
| `maxTotalChars` | 8000    | Maximum total characters across all entries                   |
| `editableBy`    | `"any"` | Who can call the memory tool: `"any"`, `"admin"`, or `"none"` |
| `nudgeInterval` | 10      | Prompt the agent to save every N turns (0 to disable)         |
| `sessionSearch` | `true`  | Enable session search tool for querying past sessions         |

## Scope (per-user isolation)

For ISVs embedding the agent in a multi-tenant app, `scope_id` gives each end user fully isolated memory, store partitions, and session history — without running separate agent instances.

**Passing a scope:**

- Local dev: include `scope_id` in the chat request body
- Cloud / JWT auth: include `scope_id` in JWT claims

**Config:**

```json
{
  "scope": {
    "requireScope": true
  }
}
```

Set `requireScope: true` to reject any request that doesn't include a `scope_id`. Useful for multi-tenant deployments where unisolated requests should never be allowed.

**Shared stores:**

By default, stores are partitioned per scope. To make a store shared across all scopes (e.g. a read-only product catalog), add `"shared": true` to the store JSON file:

```json
{
  "name": "product-catalog",
  "shared": true,
  "entity": { ... }
}
```

**Context injection:**

Connection specs can inject scope context values (passed with the request) into API calls automatically — as query params, headers, path variables, or body fields. Configure in the connection's `contextInjection` map:

```json
{
  "contextInjection": {
    "tenant_id": { "in": "header", "field": "X-Tenant-ID", "required": true }
  }
}
```

**Per-scope credentials:**

Use `scope:KEY` in connection headers/auth to read credentials from the scope's secrets map. In local dev, define these in `.amodal/scopes.json` keyed by scope ID.

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

**Core** handles shared agent-building primitives — repo/config loading, knowledge formatting, package management, snapshots, evals, MCP helpers, and shared security utilities.

**Runtime** is the agent execution layer and HTTP server — the agent loop, provider dispatch, tool registration/execution, SSE streaming, session management, persistent stores, automation/webhook handling, and runtime guardrails.

**CLI** is the developer interface — scaffold projects, run local dev servers, deploy, manage connections, and run evals.

## Packages

Primary packages:

| Package                                   | What it does                                                                                  | Who uses it                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`@amodalai/core`](./packages/core)       | Shared agent SDK primitives — config/repo loading, packages, snapshots, evals, MCP, knowledge | Anyone building on or extending Amodal    |
| [`@amodalai/runtime`](./packages/runtime) | HTTP server — SSE streaming, session management, stores                                       | Anyone self-hosting the agent server      |
| [`@amodalai/amodal`](./packages/cli)      | CLI — chat, deploy, init, connect, eval                                                       | Every developer using the platform        |
| [`@amodalai/react`](./packages/react)     | React hooks, components, chat widget, and embeddable UI                                       | ISVs embedding the agent in their product |

Supporting workspace packages:

| Package                                                   | What it does                                     |
| --------------------------------------------------------- | ------------------------------------------------ |
| [`@amodalai/types`](./packages/types)                     | Shared zero-dependency type definitions          |
| [`@amodalai/db`](./packages/db)                           | Shared Drizzle schema and Postgres helpers       |
| [`@amodalai/studio`](./packages/studio)                   | Agent editor, draft workspace, and Studio server |
| [`@amodalai/studio-client`](./packages/studio-client)     | HTTP client for the Studio API                   |
| [`@amodalai/runtime-app`](./packages/runtime-app)         | Vite runtime/admin UI                            |
| [`@amodalai/snapshot-probe`](./packages/snapshot-probe)   | Release workflow smoke-test package              |
| [`@amodalai/workspace-tools`](./packages/workspace-tools) | Internal workspace filesystem tools              |
| [`@amodalai/test-utils`](./packages/test-utils)           | Internal test helpers                            |
| [`@amodalai/docs`](./packages/docs)                       | Documentation site                               |

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

| Command                | Description                        |
| ---------------------- | ---------------------------------- |
| `amodal pkg install`   | Install packages                   |
| `amodal pkg uninstall` | Remove a package                   |
| `amodal pkg link`      | Link project to platform app       |
| `amodal pkg sync`      | Sync API specs from remote sources |

### `amodal connect` — Connections and channels

| Command                     | Description               |
| --------------------------- | ------------------------- |
| `amodal connect connection` | Add a connection package  |
| `amodal connect channel`    | Add a channel integration |

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

Supported directly: **Anthropic** (default), **OpenAI**, and **Google Gemini**.

OpenAI-compatible providers are supported by known provider names (`deepseek`, `groq`, `mistral`, `xai`, `fireworks`, `together`) or by setting `baseUrl` for another compatible endpoint.

## Web search & fetch

Enable the built-in `web_search` and `fetch_url` tools by adding a `webTools` block to `amodal.json`:

```json
{
  "webTools": {
    "provider": "google",
    "apiKey": "env:GOOGLE_API_KEY",
    "model": "gemini-3-flash-preview"
  }
}
```

When present, both tools are registered automatically on every session. They route through a dedicated Gemini Flash instance with Google Search + `urlContext` grounding, so the agent gets synthesized answers with cited source URLs — **regardless of what the main model is**. An Anthropic- or OpenAI-backed agent will still use the Gemini backend for search and URL fetch.

- `web_search(query, max_results?)` — grounded search, returns answer + cited URLs
- `fetch_url(url, prompt?)` — fetches a URL via Gemini `urlContext`; falls back to local HTTP + Mozilla Readability for private-network URLs (localhost, RFC1918)

Requires a Google API key (`GOOGLE_API_KEY`). The grounding free tier is 5K queries/month on Gemini 2.5+ models. `model` defaults to `gemini-3-flash-preview`; swap to `gemini-2.5-flash` or `gemini-3.1-flash-lite-preview` as your cost/quality trade-off dictates.

**Behavior when unconfigured or misconfigured:**

| Situation                                                           | Result                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webTools` block absent from `amodal.json`                          | Tools not registered. Agents don't see them in their tool list. Startup log: `web_tools_not_configured`.                                                                                                                                                              |
| `webTools` present, `apiKey: "env:GOOGLE_API_KEY"`, env var not set | Boot fails fast with `ConfigError: Environment variable "GOOGLE_API_KEY" is not set`.                                                                                                                                                                                 |
| Key is set but invalid/expired/quota-exhausted                      | Tools register; at call time `web_search` returns a structured `{status: 'error', content: ..., retryable: bool}` with specific guidance (e.g. "DO NOT retry, check GOOGLE_API_KEY" on 400/401/403, "may retry once" on 5xx) so the agent knows whether to try again. |

## Developing from Source

```bash
# Clone and build
git clone git@github.com:amodalai/amodal.git
cd amodal
pnpm install
pnpm run build

# Link the CLI so `amodal` runs from source
pnpm link --global
```

Now `amodal` on your PATH runs your local build. Verify with:

```bash
amodal --version   # should show X.Y.Z-dev
```

If you previously installed via `npm install -g @amodalai/amodal`, remove it so there's no ambiguity:

```bash
npm uninstall -g @amodalai/amodal
```

Use it from any agent repo:

```bash
cd /path/to/my-agent
amodal dev
```

When you change code, rebuild and restart:

```bash
pnpm dev:build    # rebuilds CLI + runtime + runtime-app
```

All workspace dependencies resolve through pnpm, so you always run your local source.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, project structure, and how to submit changes.

## Security

See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

## License

[MIT](./LICENSE)
