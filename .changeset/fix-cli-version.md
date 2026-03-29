---
"@amodalai/amodal": patch
---

Fix `amodal --version` showing `0.0.0`. Read version from package.json at runtime as fallback when CLI is not bundled with esbuild. Rename package from `@amodalai/cli` to `@amodalai/amodal`.
