---
"@amodalai/runtime": patch
"@amodalai/db": patch
---

Fix session persistence: stop dropping store tables on boot, stop deleting persisted sessions from the database on cleanup timer.
