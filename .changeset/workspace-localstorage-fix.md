---
"@amodalai/runtime-app": patch
---

Fix workspace localStorage storage and restore on load. Use a ref for config in onFileSaved to prevent stale closure, and restore pending changes from localStorage on mount.
