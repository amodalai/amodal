---
"@amodalai/runtime-app": patch
---

Harden workspace editing in the runtime-app: fix discard data inconsistency, surface localStorage quota errors, throw on stale-base restore, add fetch timeouts, replace empty catches with logged catches, replace bare Errors with typed WorkspaceError. Add centralized browser logger at utils/log.ts.
