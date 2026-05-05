---
"@amodalai/studio": patch
"@amodalai/amodal": patch
---

Split the local-dev runner out of `studio-server.ts` into a separate `bin.ts`.

Importing `@amodalai/studio/server` is now guaranteed side-effect-free: it just exposes `createStudioApp` and the named hooks. The previous gate (`import.meta.url === file://argv[1]`) was defeated whenever the file got bundled into a downstream consumer's entry — `import.meta.url` and `argv[1]` would both point at the consumer's bundle path, the gate evaluated true, and `main()` ran on import. This crashed cloud-studio's Vercel function on every cold start.

Changes:

- `packages/studio/src/server/bin.ts` (new) — owns `main()`, `serve()`, the PG `LISTEN` setup, signal handlers, and the `process.exit(1)` on fatal.
- `packages/studio/src/server/studio-server.ts` — keeps only the library exports and `createStudioApp`. No more `main()`, no port binding, no `initEventBridge()` call at module load.
- `packages/studio/scripts/build-server.js` — bundles `bin.ts` to `dist-server/bin.js` alongside the library bundle.
- `packages/studio/package.json` — `dev`/`start` scripts now point at `bin`.
- `packages/cli/src/commands/dev.ts` — spawns `dist-server/bin.js` (or `src/server/bin.ts` in source mode) instead of `studio-server.js`.

Local dev (`amodal dev`) behavior is unchanged. Library consumers no longer need the `import.meta.url` gate workaround.
