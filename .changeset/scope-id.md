---
"@amodalai/db": patch
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Add scope_id support for per-user session isolation

Adds `scope_id` to sessions, memory, and stores for multi-tenant data isolation.
ISVs embed the agent in their app and pass a `scope_id` per end user — each scope
gets its own memory, store partition, and session history. Includes ScopedStoreBackend
wrapper for shared store enforcement, context injection into connections, and
pluggable CredentialResolver for `scope:KEY` secret resolution.
