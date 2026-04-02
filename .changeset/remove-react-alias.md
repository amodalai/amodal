---
"@amodalai/runtime-app": patch
---

Remove monorepo-relative @amodalai/react alias from vite config. The published @amodalai/react package has proper exports, so vite resolves it from node_modules without the alias. This fixes build server builds that use the npm package outside the monorepo.
