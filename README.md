# Amodal

Open-source agent runtime platform. Define AI agents with markdown and JSON — no application code required.

[Docs](https://docs.amodalai.com) | [Getting Started](#getting-started) | [Architecture](#architecture) | [Contributing](./CONTRIBUTING.md) | [Discord](https://discord.gg/amodalai)

## What is Amodal?

Amodal lets you build production-grade AI agents by describing them in a git repo of configuration files. Define skills, tools, knowledge bases, and connections in markdown and JSON — Amodal handles the runtime, streaming, session management, and tool execution.

```
my-agent/
├── amodal.json          # Agent config — models, providers, settings
├── skills/              # What the agent can do (markdown)
├── knowledge/           # What the agent knows (markdown)
├── connections/         # External service credentials (JSON)
├── stores/              # Persistent state schemas (JSON)
├── pages/               # Custom UI surfaces beyond chat
├── automations/         # Event-triggered tasks
└── evals/               # Test cases for agent behavior
```

## Getting Started

### Install

```bash
npm install -g @amodalai/cli
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

| Package | Description |
|---------|-------------|
| [`@amodalai/core`](./packages/core) | Agent SDK — ReAct loop, tools, skills, knowledge, providers |
| [`@amodalai/runtime`](./packages/runtime) | HTTP server — SSE streaming, session management, stores |
| [`@amodalai/cli`](./packages/cli) | CLI — chat, deploy, init, connect, eval |
| [`@amodalai/react`](./packages/react) | React hooks and components for embedding agents |
| [`@amodalai/chat-widget`](./packages/chat-widget) | Embeddable chat widget |

## CLI Commands

| Command | Description |
|---------|-------------|
| `amodal init` | Scaffold a new agent project |
| `amodal dev` | Start local dev server with hot reload |
| `amodal chat` | Interactive chat session |
| `amodal connect` | Manage external service connections |
| `amodal eval` | Run evaluation suites |
| `amodal validate` | Validate agent configuration |
| `amodal build` | Build agent snapshot |
| `amodal inspect` | Inspect agent config, tools, and skills |
| `amodal install` | Install a plugin package |
| `amodal uninstall` | Remove a plugin package |
| `amodal publish` | Publish plugins to marketplace |
| `amodal search` | Search repo contents |
| `amodal diff` | Compare configurations |
| `amodal audit` | Review agent audit logs |
| `amodal docker` | Generate Docker deployment files |
| `amodal serve` | Start the runtime server |

See the [full CLI reference](https://docs.amodalai.com/cli) for cloud and platform commands (`deploy`, `login`, `secrets`, `promote`, `rollback`, and more).

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
