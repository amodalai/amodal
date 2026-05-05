---
"@amodalai/studio": patch
---

Ship type declarations for the `./server` subpath export.

The `./server` entry was missing a `types` field in `package.json`, and the build only emitted declarations for `src/lib/`. Downstream packages importing from `@amodalai/studio/server` (e.g. cloud-studio) couldn't typecheck. Now `tsconfig.build.json` includes `src/server/`, the `./server` export points at `dist-server/src/server/studio-server.d.ts`, and `studio-server.ts` re-exports the missing public types (`StudioBackend`, `PreviewResult`, `WorkspaceFile`, batch types).

Pure type-pipeline fix — no runtime changes.
