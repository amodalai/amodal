---
"@amodalai/studio": patch
---

Ship `src/` in the published package and add subpath exports for the App component, events context, config context, and styles. Allows external deployments to Vite-build their own SPA entry point that wraps the OSS Studio App with custom providers.
