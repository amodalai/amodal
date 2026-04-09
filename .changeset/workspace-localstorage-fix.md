---
"@amodalai/runtime-app": patch
---

Fix workspace localStorage storage and restore on load. useWorkspace now always returns an object so onFileSaved is available before the async config fetch completes.
