---
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
"@amodalai/amodal": patch
---

Rename AmodalRepo to AgentBundle across public APIs: snapshotToRepo → snapshotToBundle, repoProvider → bundleProvider, getRepo → getBundle, updateRepo → updateBundle, SnapshotServerConfig.repo → .bundle, SessionManagerOptions.repo → .bundle. Fix "New chat" button not resetting the chat when already on the chat screen. Fix useAmodalChat reset() not clearing sessionIdRef.
