---
"@amodalai/studio": patch
---

Re-export setAuthProvider, setBackendFactory, DrizzleStudioBackend, and
other lib functions from the ./server entry point so cloud-studio can
import everything from one working esbuild bundle.
