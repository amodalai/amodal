---
"@amodalai/studio": patch
"@amodalai/runtime": patch
---

Add a "Getting started" tab, runtime OAuth broker, and per-connection configure pages.

**Getting started tab** (`/agents/:agentId/getting-started`) — universal home for first-run agent configuration. Two render modes:

- **Templated agent** (`template.json` exists in the repo) — slot-by-slot list with the curated providers from each `template.connections[]` slot.
- **No template** — flat list of every connection package the agent has installed.

Each row shows the package's `amodal.displayName` / icon / description, declared `auth.envVars` with per-var ✓/○, and a Connect button when OAuth is available. Backed by `GET /api/getting-started`.

**Runtime-hosted OAuth broker** (`/api/oauth/{start,callback}`). When a package declares `amodal.oauth` and the user has set `<APPKEY>_CLIENT_ID` / `_CLIENT_SECRET` in env, the runtime brokers the redirect dance on the localhost loopback — no tunnel, no cloud dependency. Tokens persist to `<repoPath>/.amodal/secrets.env`, get pushed into `process.env`, and reload on every startup.

**Per-connection configure page** (`/agents/:agentId/connections/:packageName`). Reached by clicking "Configure" on a Getting Started row. Renders different forms based on `auth.type`:

- `bearer` / `api-key` → password input per envVar with description
- `basic` → username + password (when declared)
- OAuth-supported → Connect button + scopes preview alongside paste fallback
- Anything else → generic per-envVar paste form

Saves go through new `POST /api/secrets/:name` (writes to `secrets.env` + `process.env`). Backed by `GET /api/connections/:packageName` which returns the full `amodal.auth` block with `authType` + per-var status.

Cloud uses the platform-api's broker instead — same protocol, different home.
