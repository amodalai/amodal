---
"@amodalai/studio": patch
---

Read eval suite definitions from the runtime's file tree instead of loading them into Postgres at startup. Eval runs still persist to Postgres.
