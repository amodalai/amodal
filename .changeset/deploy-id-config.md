---
"@amodalai/runtime-app": patch
"@amodalai/amodal": patch
---

Refactor runtime app to use deploy-id based config bootstrap. Add useHostedConfig hook that fetches config from the platform API instead of reading server-injected window.**AMODAL_CONFIG**. Load .env from project directory in dev command. Export ./package.json from runtime-app for require.resolve compatibility.
