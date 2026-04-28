---
"@amodalai/studio": patch
"@amodalai/runtime": patch
---

Add a "Getting started" tab + runtime OAuth broker.

The tab is the universal home for first-run agent configuration. Two render modes, both backed by the new `/api/getting-started` runtime endpoint:

- **Templated agent** (`template.json` exists in the repo) — slot-by-slot list with the curated providers from each `template.connections[]` slot.
- **No template** — flat list of every connection package the agent has installed.

Each row shows the package's `amodal.displayName` / icon / description and its declared `auth.envVars`, with per-var ✓/○ for whether the env var is set. The data comes from the runtime walking each loaded connection back to its containing `package.json#amodal` and bundling the optional `template.json` from the repo root.

**Runtime-hosted OAuth broker.** When a package declares `amodal.oauth` and the user has set `<APPKEY>_CLIENT_ID` / `_CLIENT_SECRET` in their env, the Getting Started tab shows a "Connect" button. The runtime exposes:

- `GET /api/oauth/start?package=<name>` — returns an `authorizeUrl` for the studio to redirect to
- `GET /api/oauth/callback` — exchanges the code, persists tokens to `<repoPath>/.amodal/secrets.env`, sets them on `process.env`, and redirects back to the Getting Started tab

Tokens are loaded back into `process.env` on every runtime startup so they survive restarts. Cloud deployments use the platform-api's broker instead — same URL shape, different home.

Inline secret paste is still a follow-up.
