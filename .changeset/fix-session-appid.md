---
"@amodalai/runtime": patch
---

Fix session persistence in hosted mode: pass config.appId to shared resources so sessions are saved with the correct agent ID instead of "local".
