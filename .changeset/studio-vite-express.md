---
"@amodalai/studio": patch
"@amodalai/amodal": patch
---

Replace Next.js with Vite SPA + Express server

Studio no longer depends on Next.js. The UI is now a Vite-built SPA and the backend is a lightweight Express server bundled with esbuild. This fixes the SWC binary resolution issue that broke Studio when installed via `npm install -g @amodalai/amodal`.

- Package size: 396 KB compressed (was ~37 MB with Next.js standalone)
- Server startup: ~25ms (was ~3s with `next dev`)
- No native binaries, no SWC, no platform-specific dependencies
- Local dev preserved: `tsx src/server/studio-server.ts` with Vite dev proxy
- Architecture unchanged: Studio remains a separate process from Runtime
