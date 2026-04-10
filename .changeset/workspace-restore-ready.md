---
"@amodalai/runtime-app": patch
---

Await workspace restore before loading file tree. Adds `ready` state to useWorkspace so ConfigFilesPage waits for localStorage restore to complete before fetching files, preventing stale file tree after server restart.
