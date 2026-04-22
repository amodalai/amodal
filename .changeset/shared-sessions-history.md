---
"@amodalai/runtime": patch
---

Move session history routes to shared server.ts — sessions work in both local dev and hosted runtime. Add storeBackend and appId to ServerConfig. Remove duplicate routes from local-server.
