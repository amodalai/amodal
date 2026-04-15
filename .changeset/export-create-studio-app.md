---
"@amodalai/studio": patch
---

Extract `createStudioApp()` from the Studio server entry point. Returns the Express app with all middleware and routes mounted but without calling `listen()`. Allows external deployments to use Studio as a serverless handler or embed it in a custom server.
