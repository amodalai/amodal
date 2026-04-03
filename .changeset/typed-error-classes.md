---
"@amodalai/runtime": patch
---

Add typed error classes (AmodalError base + ProviderError, ToolExecutionError, StoreError, ConnectionError, SessionError, CompactionError, ConfigError) and Result<T, E> type for structured error handling across module boundaries.
