---
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Add structured logging with configurable log levels (LOG_LEVEL env var). Replace all process.stderr.write calls with a shared logger supporting debug/info/warn/error/fatal levels. Add debug-level logging of the full LLM request payload in MultiProviderContentGenerator.
