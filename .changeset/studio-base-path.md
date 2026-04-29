---
"@amodalai/studio": patch
"@amodalai/amodal": patch
---

Add BASE_PATH support to Studio for subpath deployments

Studio can now be mounted at a subpath (e.g., `/studio/`) via the `BASE_PATH` env var. Server routes, Vite asset paths, and frontend API calls all respect the prefix. Default is empty string (root), preserving existing behavior.
