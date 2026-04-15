---
"@amodalai/studio": patch
---

Add lib type declarations to the published package. The build now runs tsc alongside esbuild so `dist-server/` contains both the bundled server JS and `.d.ts` files for the lib barrel. Adds `main`, `types`, and `exports` fields to package.json so `import { ... } from '@amodalai/studio'` resolves types correctly.
