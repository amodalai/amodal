---
"@amodalai/runtime": patch
---

Fix tool discoverability and PGLite startup crash

- **System prompt tool name mismatch:** `compiler.ts` told the LLM to use `write_<store>`, `batch_<store>`, `query_stores` but the actual registered tool names are `store_<store>`, `store_<store>_batch`, `query_store`. Fixed the prompt to match the registered names.
- **Improved store tool descriptions:** more actionable text, plus `.describe()` on `query_store` Zod params so the LLM sees field-level guidance.
- **PGLite lock file clash:** `local-server.ts` wrote `server.lock` INSIDE the data dir, which PostgreSQL treats as a corrupted `postmaster.pid` and crashes with `exit(1)`. Moved to `${dataDir}.lock` (sibling path).
- **Smoke test coverage:** added 16 tests for pages, sessions, files, webhooks, stores REST, and feedback endpoints.
