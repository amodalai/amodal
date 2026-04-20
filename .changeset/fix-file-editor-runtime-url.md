---
"@amodalai/studio": patch
---

Fix file editor to call runtime directly instead of using the `/api/runtime/files` proxy route. The proxy only works in local dev — in cloud deployments, the SPA's fetch patch rewrites it to the wrong host. Now uses `runtimeUrl` from config, matching how the agent inventory hook already works.
