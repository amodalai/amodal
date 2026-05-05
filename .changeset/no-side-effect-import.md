---
"@amodalai/studio": patch
---

Don't auto-run `main()` in `studio-server.ts` when imported as a library.

Library consumers (e.g. cloud-studio on Vercel) only want `createStudioApp` and the named hooks. The unconditional `main().catch(...)` at module-load tried to bind a TCP port, opened a Postgres LISTEN connection, and `process.exit(1)`d on failure — killing serverless functions before any request could be served. It also raced ahead of downstream `disableEventBridge()` calls, since LISTEN setup begins synchronously inside the importing module's body.

Now gated by `import.meta.url === file://${process.argv[1]}` — `main()` only runs when this file is invoked directly (`node dist-server/studio-server.js`), preserving the existing local-dev behavior. Library imports are pure: nothing happens until the consumer calls `createStudioApp()`.
