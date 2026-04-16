---
"@amodalai/studio": patch
---

Re-export lib functions from ./server entry point for cloud-studio

The ./server export now re-exports setAuthProvider, setBackendFactory,
DrizzleStudioBackend, logger, and error classes so cloud-studio can
import everything from one working esbuild bundle entry point.
