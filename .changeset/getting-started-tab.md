---
"@amodalai/studio": patch
"@amodalai/runtime": patch
---

Add a "Getting started" tab + `/api/getting-started` runtime endpoint.

The tab is the universal home for first-run agent configuration. Two render modes, both backed by the same data:

- **Templated agent** (`template.json` exists in the repo) — slot-by-slot list with the curated providers from each `template.connections[]` slot.
- **No template** — flat list of every connection package the agent has installed.

Each row shows the package's `amodal.displayName` / icon / description and its declared `auth.envVars`, with per-var ✓/○ for whether the env var is set. The data comes from the new runtime endpoint, which walks loaded connections back to their containing `package.json#amodal` and bundles the optional `template.json` from the repo root.

Today this is read-only — Sally pastes credentials via the existing Secrets tab (or admin chat) and refreshes Getting Started to see ✓ flip on. Inline paste is a follow-up.
