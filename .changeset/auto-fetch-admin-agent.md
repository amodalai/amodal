---
"@amodalai/amodal": patch
---

Auto-fetch admin agent on first `amodal dev`

`amodal dev` now calls `ensureAdminAgent()` which automatically downloads `@amodalai/agent-admin` from npm on first run. Previously the admin agent was silently skipped if not manually cached at `~/.amodal/admin-agent/`.
